import { BrowserWindow, app, screen } from 'electron'
import { join } from 'node:path'
import { store } from './store'

export const SIDEBAR_WIDTH = 64
export let quitting = false
export function setQuitting(v: boolean): void {
  quitting = v
}

let win: BrowserWindow | null = null
export function mainWindow(): BrowserWindow | null {
  return win
}

export function createWindow(showOnStart: boolean): BrowserWindow {
  const saved = store.get('bounds')
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width: saved?.width ?? Math.min(1400, sw),
    height: saved?.height ?? Math.min(900, sh),
    x: saved?.x,
    y: saved?.y,
    show: false,
    title: 'Mailwrap',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/shell.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (showOnStart) win.once('ready-to-show', () => win?.show())

  const saveBounds = (): void => {
    if (win && !win.isMinimized() && !win.isMaximized()) store.set('bounds', win.getBounds())
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // X button: hide to tray instead of quitting.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => {
    win = null
  })
  return win
}

export function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else showWindow()
}
