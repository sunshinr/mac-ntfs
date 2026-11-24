import { ipcMain } from 'electron'
import type { MountOptions, Settings } from '../shared/types'
import { IPC } from '../shared/ipc'
import type { AppController } from './controller'

/** IPC 入口集中在这里做参数校验，避免渲染层传入非法值。 */
export function registerIpc(controller: AppController): void {
  ipcMain.handle(IPC.getState, () => controller.getState())

  ipcMain.handle(IPC.refresh, () => controller.refresh('手动刷新'))

  ipcMain.handle(IPC.mount, (_event, volumeId: unknown, options: unknown) => {
    if (typeof volumeId !== 'string' || !volumeId) {
      return { ok: false, code: 'UNKNOWN', message: '卷标识无效' }
    }
    return controller.mount(volumeId, normalizeMountOptions(options))
  })

  ipcMain.handle(IPC.unmount, (_event, volumeId: unknown, force: unknown) => {
    if (typeof volumeId !== 'string' || !volumeId) {
      return { ok: false, code: 'UNKNOWN', message: '卷标识无效' }
    }
    return controller.unmount(volumeId, force === true)
  })

  ipcMain.handle(IPC.diagnose, () => controller.diagnose())

  ipcMain.handle(IPC.saveSettings, (_event, patch: unknown) => {
    return controller.saveSettings(normalizeSettingsPatch(patch))
  })

  ipcMain.handle(IPC.getLogs, () => controller.getLogs())
  ipcMain.handle(IPC.clearLogs, () => controller.clearLogs())
  ipcMain.handle(IPC.openLogDir, () => controller.openLogDir())

  ipcMain.handle(IPC.revealPath, (_event, path: unknown) => {
    if (typeof path === 'string' && path.startsWith('/')) controller.revealPath(path)
  })

  ipcMain.handle(IPC.openExternal, (_event, url: unknown) => {
    if (typeof url === 'string') controller.openExternal(url)
  })

  ipcMain.handle(IPC.openSecuritySettings, () => controller.openSecuritySettings())
}

function normalizeMountOptions(input: unknown): MountOptions {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  return {
    readOnly: raw.readOnly === true,
    force: raw.force === true
  }
}

function normalizeSettingsPatch(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const patch: Partial<Settings> = {}

  const booleanKeys: Array<keyof Settings> = [
    'autoMount',
    'readOnlyByDefault',
    'allowOther',
    'autoXattr',
    'showNonNtfs',
    'launchAtLogin',
    'disclaimerAccepted'
  ]
  for (const key of booleanKeys) {
    if (typeof raw[key] === 'boolean') {
      ;(patch as Record<string, unknown>)[key] = raw[key]
    }
  }
  if (typeof raw.extraOptions === 'string') patch.extraOptions = raw.extraOptions
  if (typeof raw.pollIntervalMs === 'number') patch.pollIntervalMs = raw.pollIntervalMs

  return patch
}
