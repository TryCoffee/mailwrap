import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { Account } from '../shared'
import { setQuitting, showWindow, toggleWindow } from './window'

let tray: Tray | null = null
let unreadTotal = 0

function iconPath(unread: boolean): string {
  const base = join(app.getAppPath(), 'resources')
  if (process.platform === 'darwin') return join(base, 'trayTemplate.png')
  return join(base, unread ? 'tray-unread.png' : 'tray.png')
}

export function createTray(): Tray {
  tray = new Tray(nativeImage.createFromPath(iconPath(false)))
  tray.setToolTip('Mailwrap')
  tray.on('click', () => toggleWindow())
  return tray
}

export function updateTray(accounts: Account[], unread: Map<string, number>, onSelect: (id: string) => void): void {
  if (!tray) return
  unreadTotal = [...unread.values()].reduce((a, b) => a + b, 0)
  tray.setImage(nativeImage.createFromPath(iconPath(unreadTotal > 0)))
  tray.setToolTip(unreadTotal > 0 ? `Mailwrap — ${unreadTotal} unread` : 'Mailwrap')
  if (process.platform === 'linux') tray.setTitle?.('')

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { type: 'separator' },
    ...accounts.map((a) => {
      const n = unread.get(a.id) ?? 0
      return {
        label: n > 0 ? `${a.label} (${n})` : a.label,
        click: () => {
          onSelect(a.id)
          showWindow()
        }
      }
    }),
    ...(accounts.length ? [{ type: 'separator' as const }] : []),
    {
      label: 'Quit',
      click: () => {
        setQuitting(true)
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

export function unreadCount(): number {
  return unreadTotal
}
