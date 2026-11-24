import { execFile } from 'node:child_process'

export interface ExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

const DEFAULT_TIMEOUT = 20_000
const MAX_BUFFER = 8 * 1024 * 1024

/**
 * 所有外部命令统一走这里：不抛异常，返回结构化结果，便于错误码映射。
 */
export function run(
  file: string,
  args: string[] = [],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: options.env ?? process.env,
        windowsHide: true,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
        resolve({
          ok: !error,
          code: typeof err?.code === 'number' ? err.code : error ? null : 0,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          timedOut: Boolean(err?.killed),
          error: err ? String(err.message) : undefined
        })
      }
    )
  })
}

/** 执行一段 shell 脚本（仅用于固定脚本，不拼接用户输入）。 */
export function runShell(script: string, timeoutMs = DEFAULT_TIMEOUT): Promise<ExecResult> {
  return run('/bin/sh', ['-c', script], { timeoutMs })
}

/** POSIX shell 单引号转义。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** AppleScript 字符串转义（换行转为 AppleScript 的 \n 转义）。 */
export function appleScriptQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\n/g, '\\n')
  return `"${escaped}"`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 限制并发地映射数组，避免一次性 fork 大量 diskutil。 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}
