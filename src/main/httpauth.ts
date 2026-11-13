import { BrowserWindow, app, ipcMain } from 'electron'
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
    prompt(authInfo.host, authInfo.realm, authInfo.scheme).then((cred) => {
      if (cred) {
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

let queue: Promise<unknown> = Promise.resolve()

function prompt(host: string, realm: string, scheme: string): Promise<{ username: string; password: string } | null> {
  const run = (): Promise<{ username: string; password: string } | null> =>
    new Promise((resolve) => {
      const parent = mainWindow() ?? undefined
      const w = new BrowserWindow({
        width: 380,
        height: 290,
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
      const finish = (v: { username: string; password: string } | null): void => {
        if (done) return
        done = true
        ipcMain.removeHandler('auth:info')
        ipcMain.removeAllListeners('auth:submit')
        ipcMain.removeAllListeners('auth:cancel')
        if (!w.isDestroyed()) w.close()
        resolve(v)
      }
      ipcMain.handle('auth:info', () => ({ host, realm, scheme }))
      ipcMain.on('auth:submit', (_e, username: string, password: string) => finish({ username, password }))
      ipcMain.on('auth:cancel', () => finish(null))
      w.on('closed', () => finish(null))
      if (process.env.ELECTRON_RENDERER_URL) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/auth.html`)
      else w.loadFile(join(__dirname, '../renderer/auth.html'))
    })
  const p = queue.then(run)
  queue = p.catch(() => undefined)
  return p
}
