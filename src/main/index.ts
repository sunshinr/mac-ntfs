import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { AppController } from './controller'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged
let controller: AppController | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    show: false,
    title: 'NTFS for Mac',
    backgroundColor: '#f2f3f5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  if (process.env.NTFS4MAC_DEBUG === '1') {
    window.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    window.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('[renderer] 加载失败', code, description)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] 渲染进程退出', details.reason)
    })
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  controller?.setWindow(window)
  window.on('closed', () => controller?.setWindow(null))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function buildMenu(): void {
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about', label: '关于 NTFS for Mac' },
      { type: 'separator' },
      { role: 'hide', label: '隐藏' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: '退出 NTFS for Mac' }
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新载入' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '全屏' }
    ]
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: '帮助',
    submenu: [
      {
        label: '项目主页',
        click: () => void shell.openExternal('https://github.com/sunshinr/mac-ntfs')
      },
      {
        label: 'macFUSE 官网',
        click: () => void shell.openExternal('https://macfuse.github.io/')
      },
      {
        label: 'macFUSE 系统扩展授权说明',
        click: () =>
          void shell.openExternal(
            'https://github.com/macfuse/macfuse/wiki/Getting-Started#enabling-the-system-extension'
          )
      }
    ]
  }

  const template: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [appMenu, editMenu, viewMenu, { role: 'windowMenu', label: '窗口' }, helpMenu]
      : [editMenu, viewMenu, helpMenu]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: 'NTFS for Mac',
      applicationVersion: app.getVersion(),
      credits: '基于 macFUSE + ntfs-3g 的 NTFS 读写管理工具'
    })

    buildMenu()

    controller = new AppController()
    await controller.init()
    registerIpc(controller)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    controller?.dispose()
    controller = null
  })

  if (isDev) {
    process.on('SIGINT', () => app.quit())
  }
}
