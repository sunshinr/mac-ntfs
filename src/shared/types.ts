/**
 * 主进程 / 预加载 / 渲染进程共用的类型定义。
 * 这里不能依赖 Node 或 Electron 的类型，保证渲染层可以直接引用。
 */

export type ErrorCode =
  | 'PERMISSION_DENIED'
  | 'VOLUME_BUSY'
  | 'HIBERNATED'
  | 'ENGINE_MISSING'
  | 'FUSE_UNAVAILABLE'
  | 'NOT_NTFS'
  | 'ALREADY_MOUNTED'
  | 'NOT_MACOS'
  | 'NOT_MOUNTED'
  | 'MOUNT_POINT_BLOCKED'
  | 'TIMEOUT'
  | 'UNKNOWN'

export type BackendKind = 'kext' | 'fskit' | 'unknown'
export type PrivilegeMode = 'helper' | 'osascript' | 'mock'
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'
export type VolumeOwner = 'none' | 'system' | 'ntfs4mac'
export type CheckLevel = 'pass' | 'warn' | 'fail'

export interface BackendIssue {
  code: ErrorCode
  title: string
  detail: string
  hint: string
  /** 是否需要引导用户去处理（UI 展示引导入口） */
  actionable: boolean
}

export interface MacFuseStatus {
  installed: boolean
  version: string | null
  kextLoaded: boolean
  path: string
}

export interface Ntfs3gStatus {
  installed: boolean
  path: string | null
  version: string | null
}

export interface HelperStatus {
  connected: boolean
  mode: PrivilegeMode
  socketPath: string
  detail: string
}

export interface BackendStatus {
  platform: string
  isMac: boolean
  mock: boolean
  osVersion: string
  osName: string
  arch: string
  chip: string
  sipEnabled: boolean | null
  brewPrefix: string | null
  backend: BackendKind
  macfuse: MacFuseStatus
  ntfs3g: Ntfs3gStatus
  helper: HelperStatus
  issues: BackendIssue[]
  checkedAt: number
}

export interface VolumeInfo {
  /** 稳定唯一标识，使用设备标识符，例如 disk4s1 */
  id: string
  /** 设备节点，例如 /dev/disk4s1 */
  device: string
  name: string
  mountPoint: string | null
  size: number
  freeSpace: number | null
  /** 例如 ntfs / macfuse / exfat */
  fsType: string
  /** diskutil 的分区类型，例如 Windows_NTFS */
  content: string
  isNTFS: boolean
  mounted: boolean
  readOnly: boolean
  writable: boolean
  owner: VolumeOwner
  removable: boolean
  internal: boolean
  solidState: boolean
  bus: string
  diskName: string
}

export interface MountOptions {
  readOnly?: boolean
  force?: boolean
}

export interface OperationResult {
  ok: boolean
  code?: ErrorCode
  message?: string
  hint?: string
  volumeId?: string
  mountPoint?: string
  /** 失败时对应的日志文件路径，便于用户排查 */
  logPath?: string
}

export interface Settings {
  autoMount: boolean
  readOnlyByDefault: boolean
  allowOther: boolean
  autoXattr: boolean
  extraOptions: string
  pollIntervalMs: number
  showNonNtfs: boolean
  launchAtLogin: boolean
  disclaimerAccepted: boolean
}

export interface DiagnosticCheck {
  id: string
  title: string
  level: CheckLevel
  detail: string
  hint?: string
}

export interface DiagnosticReport {
  checks: DiagnosticCheck[]
  generatedAt: number
  summary: { pass: number; warn: number; fail: number }
}

export interface LogEntry {
  id: string
  time: number
  level: LogLevel
  scope: string
  message: string
  detail?: string
}

export interface ToastPayload {
  level: 'success' | 'warning' | 'error' | 'info'
  message: string
  detail?: string
}

export interface AppState {
  appVersion: string
  status: BackendStatus
  volumes: VolumeInfo[]
  settings: Settings
  diagnostics: DiagnosticReport | null
  busy: Record<string, boolean>
  refreshing: boolean
  lastRefresh: number
  engineReady: boolean
  logFile: string
}

export interface IpcApi {
  getState(): Promise<AppState>
  refresh(): Promise<AppState>
  mount(volumeId: string, options?: MountOptions): Promise<OperationResult>
  unmount(volumeId: string, force?: boolean): Promise<OperationResult>
  diagnose(): Promise<DiagnosticReport>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  getLogs(): Promise<LogEntry[]>
  clearLogs(): Promise<void>
  openLogDir(): Promise<void>
  revealPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  openSecuritySettings(): Promise<void>
  onState(handler: (state: AppState) => void): () => void
  onLog(handler: (entry: LogEntry) => void): () => void
  onToast(handler: (toast: ToastPayload) => void): () => void
}


