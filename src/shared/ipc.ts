/** 主进程与渲染进程的 IPC 通道常量，避免魔法字符串。 */
export const IPC = {
  getState: 'app:get-state',
  refresh: 'app:refresh',
  mount: 'volume:mount',
  unmount: 'volume:unmount',
  diagnose: 'app:diagnose',
  saveSettings: 'settings:save',
  getLogs: 'log:get',
  clearLogs: 'log:clear',
  openLogDir: 'log:open-dir',
  revealPath: 'shell:reveal',
  openExternal: 'shell:open-external',
  openSecuritySettings: 'shell:open-security-settings',
  eventState: 'event:state',
  eventLog: 'event:log',
  eventToast: 'event:toast'
} as const
