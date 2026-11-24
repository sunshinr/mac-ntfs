import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '../../shared/types'

const MAX_MEMORY_ENTRIES = 800

export class Logger {
  private readonly entries: LogEntry[] = []
  private readonly listeners = new Set<(entry: LogEntry) => void>()
  private readonly file: string
  private seq = 0

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    this.file = join(directory, `app-${stamp}.log`)
  }

  get logFile(): string {
    return this.file
  }

  getLogs(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries.length = 0
    try {
      writeFileSync(this.file, '')
    } catch {
      /* 日志文件被占用时忽略 */
    }
  }

  onLog(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  debug(scope: string, message: string, detail?: string): void {
    this.write('debug', scope, message, detail)
  }

  info(scope: string, message: string, detail?: string): void {
    this.write('info', scope, message, detail)
  }

  success(scope: string, message: string, detail?: string): void {
    this.write('success', scope, message, detail)
  }

  warn(scope: string, message: string, detail?: string): void {
    this.write('warn', scope, message, detail)
  }

  error(scope: string, message: string, detail?: string): void {
    this.write('error', scope, message, detail)
  }

  private write(level: LogLevel, scope: string, message: string, detail?: string): void {
    const entry: LogEntry = {
      id: `${Date.now()}-${++this.seq}`,
      time: Date.now(),
      level,
      scope,
      message,
      detail
    }

    this.entries.push(entry)
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES)
    }

    const line = `${new Date(entry.time).toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${
      detail ? ` | ${detail}` : ''
    }\n`
    try {
      appendFileSync(this.file, line)
    } catch {
      /* 忽略磁盘写入失败，不影响主流程 */
    }

    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch {
        /* 单个订阅者异常不应影响其他订阅者 */
      }
    }
  }
}
