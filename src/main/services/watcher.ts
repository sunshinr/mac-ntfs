import { spawn, type ChildProcess } from 'node:child_process'
import { run } from './exec'
import type { Logger } from './logger'

interface WatcherOptions {
  mock: boolean
  intervalMs: number
  darBinary: string | null
  onChanged: (reason: string) => void
  logger: Logger
}

const DEBOUNCE_MS = 700

/**
 * 磁盘事件监听。
 * 优先使用 Disk Arbitration C API 编写的 dar-monitor（helper/dar-monitor），
 * 不可用时回退为 diskutil 轮询，保证插盘仍能触发刷新与自动挂载。
 */
export class VolumeWatcher {
  private timer: NodeJS.Timeout | null = null
  private child: ChildProcess | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private snapshot = ''
  private stopped = false

  constructor(private readonly options: WatcherOptions) {}

  start(): void {
    if (this.options.mock) return
    this.stopped = false

    if (this.options.darBinary) {
      this.startDarMonitor(this.options.darBinary)
      return
    }
    this.options.logger.info('watcher', '未找到 dar-monitor，使用 diskutil 轮询监听磁盘变化')
    this.startPolling()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    if (this.child) {
      this.child.removeAllListeners('exit')
      this.child.kill()
    }
    this.child = null
  }

  restart(intervalMs: number): void {
    const dar = this.options.darBinary
    this.stop()
    this.options.intervalMs = intervalMs
    this.options.darBinary = dar
    this.start()
  }

  private startDarMonitor(binary: string): void {
    try {
      const child = spawn(binary, [], { stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      this.options.logger.info('watcher', '已启用 Disk Arbitration 事件监听', binary)

      let buffer = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString()
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line) this.handleDarLine(line)
          newline = buffer.indexOf('\n')
        }
      })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string | Buffer) => {
        const text = chunk.toString().trim()
        if (text) this.options.logger.debug('watcher', text)
      })

      child.on('error', (error) => {
        this.options.logger.warn('watcher', 'dar-monitor 启动失败，回退轮询', String(error))
        this.child = null
        if (!this.stopped) this.startPolling()
      })

      child.on('exit', (code) => {
        this.options.logger.warn('watcher', `dar-monitor 退出（${code ?? 'signal'}），回退轮询`)
        this.child = null
        if (!this.stopped) this.startPolling()
      })
    } catch (error) {
      this.options.logger.warn('watcher', 'dar-monitor 异常，回退轮询', String(error))
      this.startPolling()
    }
  }

  private handleDarLine(line: string): void {
    try {
      const event = JSON.parse(line) as { event?: string; device?: string; volumeName?: string }
      if (!event.event) return
      this.options.logger.debug(
        'watcher',
        `磁盘事件：${event.event}`,
        [event.device, event.volumeName].filter(Boolean).join(' ')
      )
      if (event.event === 'appeared' || event.event === 'disappeared' || event.event === 'changed') {
        this.schedule(event.event)
      }
    } catch {
      /* 非 JSON 行忽略 */
    }
  }

  private startPolling(): void {
    if (this.stopped || this.timer) return
    this.stopped = false
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs)
  }

  private async poll(): Promise<void> {
    if (this.stopped) return
    const result = await run('/usr/sbin/diskutil', ['list'], { timeoutMs: 10_000 })
    if (!result.ok) return

    const snapshot = Array.from(new Set(result.stdout.match(/disk\d+s\d+/g) ?? []))
      .sort()
      .join(',')

    if (!this.snapshot) {
      this.snapshot = snapshot
      return
    }
    if (snapshot !== this.snapshot) {
      this.snapshot = snapshot
      this.schedule('poll')
    }
  }

  private schedule(reason: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      if (!this.stopped) this.options.onChanged(reason)
    }, DEBOUNCE_MS)
  }
}
