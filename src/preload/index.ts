import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, LogEntry, AppState, ToastPayload } from '../shared/types'
import { IPC } from '../shared/ipc'

/**
 * 渲染进程只通过这个受限 API 与主进程通信：
 * - 不暴露 ipcRenderer 本体，避免任意通道调用
 * - 每个订阅方法返回取消订阅函数，组件卸载时调用
 */
const api: IpcApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  refresh: () => ipcRenderer.invoke(IPC.refresh),
  mount: (volumeId, options) => ipcRenderer.invoke(IPC.mount, volumeId, options),
  unmount: (volumeId, force) => ipcRenderer.invoke(IPC.unmount, volumeId, force),
  diagnose: () => ipcRenderer.invoke(IPC.diagnose),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  getLogs: () => ipcRenderer.invoke(IPC.getLogs),
  clearLogs: () => ipcRenderer.invoke(IPC.clearLogs),
  openLogDir: () => ipcRenderer.invoke(IPC.openLogDir),
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  openSecuritySettings: () => ipcRenderer.invoke(IPC.openSecuritySettings),
  onState: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => handler(state)
    ipcRenderer.on(IPC.eventState, listener)
    return () => ipcRenderer.removeListener(IPC.eventState, listener)
  },
  onLog: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntry): void => handler(entry)
    ipcRenderer.on(IPC.eventLog, listener)
    return () => ipcRenderer.removeListener(IPC.eventLog, listener)
  },
  onToast: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, toast: ToastPayload): void => handler(toast)
    ipcRenderer.on(IPC.eventToast, listener)
    return () => ipcRenderer.removeListener(IPC.eventToast, listener)
  }
}

contextBridge.exposeInMainWorld('api', api satisfies IpcApi)
