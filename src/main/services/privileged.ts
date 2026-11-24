import { readFile } from 'node:fs/promises'
import * as net from 'node:net'
import type { HelperStatus, PrivilegeMode } from '../../shared/types'
import type { ExecResult } from './exec'
import { appleScriptQuote, run, shellQuote } from './exec'
import type { Logger } from './logger'

interface HelperResponse {
  id?: string
  ok?: boolean
  code?: number | null
  stdout?: string
  stderr?: string
  pid?: number
  alive?: boolean
  error?: string
}

export interface SpawnResult {
  ok: boolean
  pid?: number
  message?: string
}

const PROBE_CACHE_MS = 15_000

/**
 * 特权执行层。
 * 1) 首选：与 root LaunchDaemon 通过 UNIX socket 通信（helper 模式，无弹窗）
 * 2) 兜底：osascript `with administrator privileges`（开发/未安装助手时可用）
 * 3) 演示：直接返回成功，不触碰系统
 */
export class PrivilegedService {
  readonly socketPath = '/var/run/ntfs4mac/helper.sock'
  readonly logDir = '/var/log/ntfs4mac'

  private mode: PrivilegeMode = 'mock'
  private detail = '演示模式：不会执行真实特权命令'
  private seq = 0
  private lastProbeAt = 0
  private lastProbe: HelperStatus | null = null

  constructor(
    private readonly isMac: boolean,
    private readonly mock: boolean,
    private readonly logger: Logger
  ) {}

  async probe(force = false): Promise<HelperStatus> {
    if (this.mock) {
      this.mode = 'mock'
      return this.status(true)
    }
    if (!this.isMac) {
      this.mode = 'mock'
      return this.status(false)
    }
    if (!force && this.lastProbe && Date.now() - this.lastProbeAt < PROBE_CACHE_MS) {
      return this.lastProbe
    }

    try {
      const response = await this.request({ action: 'ping' }, 1500)
      if (!response.ok) throw new Error(response.error ?? 'ping 未返回 ok')
      this.mode = 'helper'
      this.detail = '已连接特权助手 LaunchDaemon，无需重复输入密码'
    } catch (error) {
      this.mode = 'osascript'
      this.detail = '特权助手未运行，将使用系统管理员授权弹窗'
      this.logger.debug('privilege', this.detail, String(error))
    }

    this.lastProbeAt = Date.now()
    this.lastProbe = this.status(this.mode === 'helper')
    return this.lastProbe
  }

  async run(argv: string[], timeoutMs = 20_000): Promise<ExecResult> {
    if (argv.length === 0) {
      return { ok: false, code: 1, stdout: '', stderr: '空命令', timedOut: false }
    }

    if (this.mode === 'mock') {
      this.logger.info('privilege', `[模拟] ${argv.join(' ')}`)
      return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
    }

    if (this.mode === 'helper') {
      try {
        const response = await this.request({ action: 'run', argv, timeoutMs }, timeoutMs + 5000)
        return {
          ok: Boolean(response.ok),
          code: response.code ?? (response.ok ? 0 : 1),
          stdout: response.stdout ?? '',
          stderr: response.stderr ?? response.error ?? '',
          timedOut: false
        }
      } catch (error) {
        this.logger.error('privilege', '特权助手调用失败', String(error))
        return { ok: false, code: 1, stdout: '', stderr: String(error), timedOut: false }
      }
    }

    const command = argv.map(shellQuote).join(' ')
    const script = `do shell script ${appleScriptQuote(command)} with administrator privileges`
    // 用户输入管理员密码可能较慢，给足授权时间
    return run('/usr/bin/osascript', ['-e', script], {
      timeoutMs: Math.max(timeoutMs + 30_000, 120_000)
    })
  }

  /**
   * 启动常驻进程（ntfs-3g 挂载后即为前台守护），立即返回 pid。
   */
  async spawnDetached(argv: string[], logPath: string): Promise<SpawnResult> {
    if (this.mode === 'mock') {
      this.logger.info('privilege', `[模拟] 启动 ${argv.join(' ')}`)
      return { ok: true, pid: 4242 }
    }

    if (this.mode === 'helper') {
      try {
        const response = await this.request(
          { action: 'spawn', argv, logPath, startupWaitMs: 1200 },
          30_000
        )
        return {
          ok: Boolean(response.ok) && response.alive !== false,
          pid: response.pid,
          message: response.stderr ?? response.error
        }
      } catch (error) {
        return { ok: false, message: String(error) }
      }
    }

    const script = [
      `mkdir -p ${shellQuote(this.logDir)} && chmod 755 ${shellQuote(this.logDir)}`,
      `LOG=${shellQuote(logPath)}`,
      ': > "$LOG"',
      `nohup ${argv.map(shellQuote).join(' ')} >>"$LOG" 2>&1 </dev/null &`,
      'echo $!'
    ].join('\n')

    const wrapper = `do shell script ${appleScriptQuote(script)} with administrator privileges`
    const result = await run('/usr/bin/osascript', ['-e', wrapper], { timeoutMs: 150_000 })
    if (!result.ok) {
      return { ok: false, message: result.stderr || result.error || '管理员授权失败' }
    }
    const pid = Number(result.stdout.trim())
    return { ok: true, pid: Number.isFinite(pid) ? pid : undefined }
  }

  async isAlive(pid: number): Promise<boolean> {
    if (this.mode === 'mock') return true
    const result = await run('/bin/ps', ['-p', String(pid), '-o', 'stat='], { timeoutMs: 5000 })
    const stat = result.stdout.trim()
    return result.ok && stat.length > 0 && !stat.startsWith('Z')
  }

  async readLogTail(logPath: string, maxBytes = 4000): Promise<string> {
    try {
      const content = await readFile(logPath, 'utf8')
      return content.slice(-maxBytes)
    } catch {
      return ''
    }
  }

  private status(connected: boolean): HelperStatus {
    return {
      connected,
      mode: this.mode,
      socketPath: this.socketPath,
      detail: this.detail
    }
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<HelperResponse> {
    return new Promise((resolve, reject) => {
      const id = String(++this.seq)
      const socket = net.createConnection(this.socketPath)
      let buffer = ''
      let settled = false

      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        action()
      }

      const timer = setTimeout(() => finish(() => reject(new Error('特权助手响应超时'))), timeoutMs)

      socket.setEncoding('utf8')
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id, ...payload })}\n`)
      })
      socket.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString()
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline)
        try {
          const parsed = JSON.parse(line) as HelperResponse
          finish(() => resolve(parsed))
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
        }
      })
      socket.on('error', (error) => finish(() => reject(error)))
    })
  }
}
