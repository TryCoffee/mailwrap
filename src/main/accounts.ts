import { BrowserWindow, WebContentsView, session, shell, app, Session } from 'electron'
import { join } from 'node:path'
import { INTERNAL_HOST_RE, SERVICE_URL, type Account } from '../shared'
import { partitionFor, store } from './store'
import { SIDEBAR_WIDTH } from './window'

const views = new Map<string, WebContentsView>()
const unread = new Map<string, number>()
let activeId: string | null = null
let host: BrowserWindow | null = null

export type Listener = () => void
const listeners = new Set<Listener>()
export function onChange(l: Listener): void {
  listeners.add(l)
}
function emit(): void {
  listeners.forEach((l) => l())
}

/**
 * User agent: left as Electron's default on purpose. Google's "This browser or app may not be
 * secure" check (2026) rejects a UA that is rewritten to look like plain Chrome while client hints
 * and navigator.userAgentData still say Electron; the honest `Chrome/… Electron/… Safari/…` UA
 * passes. See stablyai/orca#11518 and #36519.
 */
export function userAgent(): string {
  return session.defaultSession.getUserAgent()
}

function configureSession(s: Session): void {
  s.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'notifications' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen')
  })
  s.setPermissionCheckHandler((_wc, permission) => permission === 'notifications' || permission === 'clipboard-sanitized-write')
  s.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) })
  })
}

export function attach(window: BrowserWindow): void {
  host = window
  window.on('resize', layout)
  window.on('maximize', layout)
  window.on('unmaximize', layout)
  window.on('enter-full-screen', layout)
  window.on('leave-full-screen', layout)
  for (const a of store.get('accounts')) ensureView(a)
  const saved = store.get('activeId')
  const first = store.get('accounts')[0]?.id ?? null
  setActive(saved && views.has(saved) ? saved : first)
}

function layout(): void {
  if (!host) return
  const [w, h] = host.getContentSize()
  for (const [id, v] of views) {
    v.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, w - SIDEBAR_WIDTH), height: h })
    v.setVisible(id === activeId)
  }
}

export function ensureView(acct: Account): WebContentsView {
  let v = views.get(acct.id)
  if (v) return v
  const s = session.fromPartition(partitionFor(acct.id))
  configureSession(s)
  v = new WebContentsView({
    webPreferences: {
      session: s,
      preload: join(__dirname, '../preload/mail.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      additionalArguments: [`--mailwrap-account=${acct.id}`]
    }
  })
  v.webContents.setWindowOpenHandler(({ url }) => {
    let hostName = ''
    try {
      hostName = new URL(url).hostname
    } catch {
      /* ignore */
    }
    if (INTERNAL_HOST_RE.test(hostName)) {
      // Auth popups (Google / Microsoft login) must stay inside the same session.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { session: s, sandbox: true, contextIsolation: true },
          autoHideMenuBar: true
        }
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  v.webContents.on('will-navigate', (e, url) => {
    let hostName = ''
    try {
      hostName = new URL(url).hostname
    } catch {
      return
    }
    if (!INTERNAL_HOST_RE.test(hostName)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  v.webContents.on('render-process-gone', () => v?.webContents.reload())
  v.webContents.loadURL(SERVICE_URL[acct.service])
  host?.contentView.addChildView(v)
  views.set(acct.id, v)
  layout()
  return v
}

export function destroyView(id: string): void {
  const v = views.get(id)
  if (!v) return
  host?.contentView.removeChildView(v)
  v.webContents.close()
  views.delete(id)
  unread.delete(id)
  session.fromPartition(partitionFor(id)).clearStorageData().catch(() => undefined)
  if (activeId === id) setActive(store.get('accounts')[0]?.id ?? null)
  emit()
}

export function setActive(id: string | null): void {
  activeId = id && views.has(id) ? id : null
  store.set('activeId', activeId)
  layout()
  if (activeId) views.get(activeId)?.webContents.focus()
  emit()
}

export function getActive(): string | null {
  return activeId
}

export function viewFor(id: string): WebContentsView | undefined {
  return views.get(id)
}

export function accountForContents(wcId: number): string | null {
  for (const [id, v] of views) if (v.webContents.id === wcId) return id
  return null
}

export function setUnread(id: string, n: number): void {
  if (unread.get(id) === n) return
  unread.set(id, n)
  emit()
}

export function unreadMap(): Map<string, number> {
  return unread
}

export function reload(id: string): void {
  views.get(id)?.webContents.reload()
}

export function cycle(dir: 1 | -1): void {
  const list = store.get('accounts')
  if (!list.length) return
  const i = list.findIndex((a) => a.id === activeId)
  setActive(list[(i + dir + list.length) % list.length].id)
}
