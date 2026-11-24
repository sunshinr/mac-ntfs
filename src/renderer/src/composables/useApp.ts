import { computed, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import type {
  AppState,
  DiagnosticReport,
  LogEntry,
  MountOptions,
  OperationResult,
  Settings,
  ToastPayload,
  VolumeInfo
} from '@shared/types'

const FALLBACK_SETTINGS: Settings = {
  autoMount: true,
  readOnlyByDefault: false,
  allowOther: true,
  autoXattr: true,
  extraOptions: '',
  pollIntervalMs: 4000,
  showNonNtfs: false,
  launchAtLogin: false,
  disclaimerAccepted: false
}

const state = ref<AppState | null>(null)
const logs = ref<LogEntry[]>([])
const booting = ref(true)
const fatal = ref<string | null>(null)

let started = false
const disposers: Array<() => void> = []

const status = computed(() => state.value?.status ?? null)
const volumes = computed<VolumeInfo[]>(() => state.value?.volumes ?? [])
const settings = computed<Settings>(() => state.value?.settings ?? FALLBACK_SETTINGS)
const issues = computed(() => status.value?.issues ?? [])
const busy = computed<Record<string, boolean>>(() => state.value?.busy ?? {})
const engineReady = computed(() => state.value?.engineReady ?? false)
const diagnostics = computed<DiagnosticReport | null>(() => state.value?.diagnostics ?? null)
const refreshing = computed(() => state.value?.refreshing ?? false)
const appVersion = computed(() => state.value?.appVersion ?? '0.0.0')
const writableCount = computed(() => volumes.value.filter((volume) => volume.writable).length)
const platform = computed(() => status.value?.platform ?? 'unknown')

function handleToast(toast: ToastPayload): void {
  if (toast.level === 'error' || toast.level === 'warning') {
    ElNotification({
      title: toast.message,
      message: toast.detail ?? '',
      type: toast.level,
      duration: toast.level === 'error' ? 9000 : 6000,
      position: 'bottom-right'
    })
    return
  }
  ElMessage({ type: toast.level, message: toast.message, duration: 3000 })
}

function notifyException(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  ElNotification({ title: '操作失败', message, type: 'error', duration: 8000, position: 'bottom-right' })
}

async function init(): Promise<void> {
  if (started) return
  started = true

  if (typeof window === 'undefined' || !window.api) {
    fatal.value = '预加载脚本未注入，无法与主进程通信'
    booting.value = false
    return
  }

  try {
    const [initialState, initialLogs] = await Promise.all([
      window.api.getState(),
      window.api.getLogs()
    ])
    state.value = initialState
    logs.value = initialLogs

    disposers.push(window.api.onState((next) => (state.value = next)))
    disposers.push(
      window.api.onLog((entry) => {
        logs.value = [...logs.value, entry].slice(-800)
      })
    )
    disposers.push(window.api.onToast(handleToast))
  } catch (error) {
    fatal.value = error instanceof Error ? error.message : String(error)
  } finally {
    booting.value = false
  }
}

async function refresh(): Promise<void> {
  if (!window.api) return
  try {
    state.value = await window.api.refresh()
  } catch (error) {
    notifyException(error)
  }
}

async function mount(volumeId: string, options: MountOptions = {}): Promise<OperationResult> {
  if (!window.api) return { ok: false, message: '主进程通道不可用' }
  try {
    return await window.api.mount(volumeId, options)
  } catch (error) {
    notifyException(error)
    return { ok: false, code: 'UNKNOWN', message: String(error) }
  }
}

async function unmount(volumeId: string, force = false): Promise<OperationResult> {
  if (!window.api) return { ok: false, message: '主进程通道不可用' }
  try {
    return await window.api.unmount(volumeId, force)
  } catch (error) {
    notifyException(error)
    return { ok: false, code: 'UNKNOWN', message: String(error) }
  }
}

async function diagnose(): Promise<DiagnosticReport | null> {
  if (!window.api) return null
  try {
    return await window.api.diagnose()
  } catch (error) {
    notifyException(error)
    return null
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (!window.api) return
  try {
    const next = await window.api.saveSettings(patch)
    if (state.value) state.value = { ...state.value, settings: next }
  } catch (error) {
    notifyException(error)
  }
}

async function clearLogs(): Promise<void> {
  if (!window.api) return
  try {
    await window.api.clearLogs()
    logs.value = []
  } catch (error) {
    notifyException(error)
  }
}

async function openLogDir(): Promise<void> {
  await window.api?.openLogDir()
}

async function openSecuritySettings(): Promise<void> {
  await window.api?.openSecuritySettings()
}

function reveal(path: string | null): void {
  if (path) void window.api?.revealPath(path)
}

function dispose(): void {
  for (const disposeListener of disposers.splice(0)) disposeListener()
}

export function useApp() {
  return {
    state,
    logs,
    booting,
    fatal,
    status,
    platform,
    volumes,
    settings,
    issues,
    busy,
    engineReady,
    diagnostics,
    refreshing,
    appVersion,
    writableCount,
    init,
    refresh,
    mount,
    unmount,
    diagnose,
    saveSettings,
    clearLogs,
    openLogDir,
    openSecuritySettings,
    reveal,
    dispose
  }
}
