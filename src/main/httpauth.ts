import { BrowserWindow, app, ipcMain, safeStorage } from 'electron'
import { store } from './store'
import { join } from 'node:path'
import { mainWindow } from './window'

/**
 * HTTP authentication (Basic / NTLM / Negotiate challenges). Chromium cancels the request
 * when nobody answers the `login` event, which shows up as a blank page, e.g. on an ADFS
 * Windows-Integrated-Auth endpoint (/adfs/ls/wia). We show a credentials prompt; cancelling
 * on such an ADFS URL retries the forms-based endpoint (/adfs/ls/) instead.
 */
export function installHttpAuth(): void {
  app.on('login', (event, webContents, details, authInfo, callback) => {
    if (authInfo.isProxy) return // let Chromium handle proxy auth
    event.preventDefault()
    const key = `${authInfo.host}:${authInfo.port}`
    const saved = loadCred(key)
    const last = lastAuto.get(key) ?? 0
    // Use remembered credentials unless we just tried them and got challenged again (= rejected).
    if (saved && Date.now() - last > 10000) {
      lastAuto.set(key, Date.now())
      callback(saved.username, saved.password)
      return
    }
    lastAuto.delete(key)
    prompt(authInfo.host, authInfo.realm, authInfo.scheme, saved?.username ?? '').then((cred) => {
      if (cred) {
        if (cred.remember) saveCred(key, cred.username, cred.password)
        else forgetCred(key)
        lastAuto.set(key, Date.now())
        callback(cred.username, cred.password)
        return
      }
      callback() // cancel
      const formsUrl = adfsFormsFallback(details.url)
      if (formsUrl && webContents && !webContents.isDestroyed()) webContents.loadURL(formsUrl)
    })
  })
}

function adfsFormsFallback(url: string): string | null {
  try {
    const u = new URL(url)
    if (/\/adfs\/ls\/wia\/?$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/wia\/?$/i, '/')
      return u.toString()
    }
  } catch {
    /* ignore */
  }
  return null
}

const lastAuto = new Map<string, number>()

interface Cred { username: string; password: string }

function loadCred(key: string): Cred | null {
  const all = store.get('httpAuth')
  const e = all[key]
  if (!e) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return { username: e.username, password: safeStorage.decryptString(Buffer.from(e.password, 'base64')) }
  } catch {
    return null
  }
}

function saveCred(key: string, username: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const all = { ...store.get('httpAuth') }
  all[key] = { username, password: safeStorage.encryptString(password).toString('base64') }
  store.set('httpAuth', all)
}

export function forgetCred(key: string): void {
  const all = { ...store.get('httpAuth') }
  delete all[key]
  store.set('httpAuth', all)
}

export function forgetAllCreds(): void {
  store.set('httpAuth', {})
}

let queue: Promise<unknown> = Promise.resolve()

type PromptResult = Cred & { remember: boolean }

function prompt(host: string, realm: string, scheme: string, username: string): Promise<PromptResult | null> {
  const run = (): Promise<PromptResult | null> =>
    new Promise((resolve) => {
      const parent = mainWindow() ?? undefined
      const w = new BrowserWindow({
        width: 380,
        height: 330,
        parent,
        modal: !!parent,
        resizable: false,
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        title: 'Sign in',
        webPreferences: { preload: join(__dirname, '../preload/auth.js'), contextIsolation: true, sandbox: true }
      })
      let done = false
      const finish = (v: PromptResult | null): void => {
        if (done) return
        done = true
        ipcMain.removeHandler('auth:info')
        ipcMain.removeAllListeners('auth:submit')
        ipcMain.removeAllListeners('auth:cancel')
        if (!w.isDestroyed()) w.close()
        resolve(v)
      }
      ipcMain.handle('auth:info', () => ({ host, realm, scheme, username, canRemember: safeStorage.isEncryptionAvailable() }))
      ipcMain.on('auth:submit', (_e, u: string, p: string, remember: boolean) => finish({ username: u, password: p, remember }))
      ipcMain.on('auth:cancel', () => finish(null))
      w.on('closed', () => finish(null))
      if (process.env.ELECTRON_RENDERER_URL) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/auth.html`)
      else w.loadFile(join(__dirname, '../renderer/auth.html'))
    })
  const p = queue.then(run)
  queue = p.catch(() => undefined)
  return p
}
