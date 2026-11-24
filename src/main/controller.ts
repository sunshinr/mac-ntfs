import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import type {
  AppState,
  BackendStatus,
  DiagnosticReport,
  LogEntry,
  MountOptions,
  OperationResult,
  Settings,
  ToastPayload,
  VolumeInfo
} from '../shared/types'
import { IPC } from '../shared/ipc'
import { buildDiagnostics } from './services/diagnostics'
import { DiskService } from './services/disks'
import { MountEngine } from './services/engine'
import { mapFailure } from './services/errors'
import { run } from './services/exec'
import { Logger } from './services/logger'
import { PlatformService } from './services/platform'
import { PrivilegedService } from './services/privileged'
import { SettingsService } from './services/settings'
import { VolumeWatcher } from './services/watcher'

/**
 * 应用编排：串起环境探测、磁盘枚举、挂载引擎、事件监听、设置与 UI 状态推送。
 */
export class AppController {
  private readonly logger: Logger
  private readonly settings: SettingsService
  private readonly platform: PlatformService
  private readonly disks: DiskService
  private readonly privileged: PrivilegedService
  private readonly engine: MountEngine
  private readonly logDir: string

  private watcher: VolumeWatcher | null = null
  private window: BrowserWindow | null = null
  private status!: BackendStatus
  private volumes: VolumeInfo[] = []
  private diagnostics: DiagnosticReport | null = null
  private busy: Record<string, boolean> = {}
  private knownDevices = new Set<string>()
  private refreshing = false
  private lastRefresh = 0
  private disposed = false
  private unsubscribeLog: (() => void) | null = null

  constructor() {
    const userData = app.getPath('userData')
    this.logDir = join(userData, 'logs')
    this.logger = new Logger(this.logDir)
    this.settings = new SettingsService(join(userData, 'settings.json'), this.logger)
    this.platform = new PlatformService(this.logger)
    this.disks = new DiskService(this.platform.mock, this.logger)
    this.privileged = new PrivilegedService(this.platform.isMac, this.platform.mock, this.logger)
    this.engine = new MountEngine(this.disks, this.privileged, this.logger, this.platform.mock)
  }

  async init(): Promise<void> {
    this.unsubscribeLog = this.logger.onLog((entry) => this.send(IPC.eventLog, entry))
    this.logger.info(
      'app',
      `NTFS for Mac ${app.getVersion()} 启动`,
      `${process.platform} ${process.arch} / Electron ${process.versions.electron}`
    )

    await this.refresh('启动', false)
    await this.autoMount(this.volumes, '启动')
    this.startWatcher()

    if (!this.settings.get().disclaimerAccepted) {
      this.logger.warn('app', '尚未确认数据安全提示，将在界面中展示')
    }
  }

  setWindow(window: BrowserWindow | null): void {
    this.window = window
  }

  getState(): AppState {
    return this.buildState()
  }

  async refresh(reason: string, allowAutoMount = true): Promise<AppState> {
    if (this.disposed) return this.buildState()
    if (this.refreshing) return this.buildState()

    this.refreshing = true
    this.broadcast()

    try {
      const helper = await this.privileged.probe()
      this.status = await this.platform.getStatus(helper)
      const volumes = await this.disks.listVolumes(this.settings.get().showNonNtfs)
      const incoming = volumes.filter((volume) => !this.knownDevices.has(volume.id))

      this.knownDevices = new Set(volumes.map((volume) => volume.id))
      this.volumes = volumes
      this.diagnostics = await buildDiagnostics(this.status, this.logger)
      this.lastRefresh = Date.now()

      if (reason !== '启动') {
        this.logger.debug('app', `磁盘状态已刷新（${reason}）`, `共 ${volumes.length} 个卷`)
      }

      this.broadcast()

      if (allowAutoMount && incoming.length > 0) {
        void this.autoMount(incoming, '检测到新磁盘')
      }

      return this.buildState()
    } catch (error) {
      this.logger.error('app', '刷新磁盘状态失败', String(error))
      return this.buildState()
    } finally {
      this.refreshing = false
      this.broadcast()
    }
  }

  async mount(volumeId: string, options: MountOptions = {}): Promise<OperationResult> {
    if (this.busy[volumeId]) {
      return { ok: false, code: 'VOLUME_BUSY', message: '该卷正在处理中，请稍候' }
    }

    const volume = this.volumes.find((item) => item.id === volumeId)
    this.busy[volumeId] = true
    this.broadcast()

    try {
      const result = await this.engine.mount(volumeId, options, this.status, this.settings.get())
      const label = volume?.name ?? volumeId
      if (result.ok) {
        this.toast('success', `${label} ${result.message ?? '挂载成功'}`)
      } else {
        this.toast('error', result.message ?? '挂载失败', result.hint)
      }
      await this.refresh(result.ok ? '挂载完成' : '挂载失败', false)
      return result
    } catch (error) {
      const mapped = mapFailure(String(error), '挂载异常')
      this.logger.error('app', mapped.message, String(error))
      this.toast('error', mapped.message, mapped.hint)
      return { ok: false, code: mapped.code, message: mapped.message, hint: mapped.hint }
    } finally {
      delete this.busy[volumeId]
      this.broadcast()
    }
  }

  async unmount(volumeId: string, force = false): Promise<OperationResult> {
    if (this.busy[volumeId]) {
      return { ok: false, code: 'VOLUME_BUSY', message: '该卷正在处理中，请稍候' }
    }

    const volume = this.volumes.find((item) => item.id === volumeId)
    this.busy[volumeId] = true
    this.broadcast()

    try {
      const result = await this.engine.unmount(volumeId, force, this.status)
      const label = volume?.name ?? volumeId
      if (result.ok) {
        this.toast('success', `${label} ${result.message ?? '已卸载'}`)
      } else {
        this.toast('error', result.message ?? '卸载失败', result.hint)
      }
      await this.refresh('卸载完成', false)
      return result
    } catch (error) {
      const mapped = mapFailure(String(error), '卸载异常')
      this.logger.error('app', mapped.message, String(error))
      this.toast('error', mapped.message, mapped.hint)
      return { ok: false, code: mapped.code, message: mapped.message, hint: mapped.hint }
    } finally {
      delete this.busy[volumeId]
      this.broadcast()
    }
  }

  async diagnose(): Promise<DiagnosticReport> {
    this.logger.info('app', '开始环境自检')
    this.diagnostics = await buildDiagnostics(this.status, this.logger)
    this.broadcast()
    return this.diagnostics
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings.get()
    const next = this.settings.save(patch)

    if (next.pollIntervalMs !== before.pollIntervalMs) {
      this.watcher?.restart(next.pollIntervalMs)
    }
    if (next.launchAtLogin !== before.launchAtLogin && process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
      this.logger.info('settings', next.launchAtLogin ? '已开启登录时启动' : '已关闭登录时启动')
    }
    if (next.showNonNtfs !== before.showNonNtfs) {
      await this.refresh('显示范围变更', false)
    } else {
      this.broadcast()
    }
    return next
  }

  getLogs(): LogEntry[] {
    return this.logger.getLogs()
  }

  clearLogs(): void {
    this.logger.clear()
    this.logger.info('app', '日志已清空')
  }

  async openLogDir(): Promise<void> {
    const error = await shell.openPath(this.logDir)
    if (error) this.logger.warn('app', '打开日志目录失败', error)
  }

  revealPath(path: string): void {
    if (!path) return
    if (existsSync(path)) {
      shell.showItemInFolder(path)
    } else {
      void shell.openPath(path)
    }
  }

  openExternal(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      this.logger.warn('app', '已拦截非 http(s) 链接', url)
      return
    }
    void shell.openExternal(url)
  }

  async openSecuritySettings(): Promise<void> {
    if (process.platform !== 'darwin') return
    const result = await run('/usr/bin/open', [
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension'
    ])
    if (!result.ok) {
      this.logger.warn('app', '打开系统设置失败，请手动前往“隐私与安全性”', result.stderr)
    }
  }

  dispose(): void {
    this.disposed = true
    this.watcher?.stop()
    this.watcher = null
    this.unsubscribeLog?.()
    this.unsubscribeLog = null
    this.logger.info('app', '应用退出')
  }

  private async autoMount(volumes: VolumeInfo[], reason: string): Promise<void> {
    const settings = this.settings.get()
    if (!settings.autoMount || !this.isEngineReady()) return
    // 演示模式不改动任何状态，避免误解为真实挂载
    if (this.status.mock) return

    const targets = volumes.filter(
      (volume) =>
        volume.isNTFS &&
        !this.busy[volume.id] &&
        !(volume.mounted && volume.owner === 'ntfs4mac')
    )
    if (targets.length === 0) return

    this.logger.info(
      'auto',
      `${reason}：准备自动挂载 ${targets.length} 个 NTFS 卷`,
      targets.map((volume) => volume.name).join(', ')
    )

    for (const volume of targets) {
      const result = await this.mount(volume.id, { readOnly: settings.readOnlyByDefault })
      if (!result.ok) {
        this.logger.warn('auto', `自动挂载 ${volume.name} 未成功`, result.message)
      }
    }
  }

  private startWatcher(): void {
    this.watcher?.stop()
    this.watcher = new VolumeWatcher({
      mock: this.platform.mock,
      intervalMs: this.settings.get().pollIntervalMs,
      darBinary: this.resolveDarBinary(),
      logger: this.logger,
      onChanged: (reason) => {
        void this.refresh(`磁盘事件（${reason}）`)
      }
    })
    this.watcher.start()
  }

  private resolveDarBinary(): string | null {
    const candidates = [
      join(process.resourcesPath, 'bin', 'dar-monitor'),
      join(app.getAppPath(), 'helper', 'build', 'dar-monitor'),
      join(app.getAppPath(), 'resources', 'bin', 'dar-monitor'),
      '/usr/local/libexec/ntfs4mac/dar-monitor'
    ]
    return candidates.find((candidate) => existsSync(candidate)) ?? null
  }

  private isEngineReady(): boolean {
    if (!this.status) return false
    if (this.status.mock) return true
    return (
      this.status.ntfs3g.installed &&
      this.status.macfuse.installed &&
      (this.status.macfuse.kextLoaded || this.status.backend === 'fskit')
    )
  }

  private buildState(): AppState {
    return {
      appVersion: app.getVersion(),
      status: this.status,
      volumes: this.volumes,
      settings: this.settings.get(),
      diagnostics: this.diagnostics,
      busy: { ...this.busy },
      refreshing: this.refreshing,
      lastRefresh: this.lastRefresh,
      engineReady: this.isEngineReady(),
      logFile: this.logger.logFile
    }
  }

  private toast(level: ToastPayload['level'], message: string, detail?: string): void {
    this.send(IPC.eventToast, { level, message, detail } satisfies ToastPayload)
  }

  private send(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  private broadcast(): void {
    this.send(IPC.eventState, this.buildState())
  }
}
