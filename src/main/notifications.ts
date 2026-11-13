import { Notification, ipcMain, nativeImage } from 'electron'
import type { NotifyPayload } from '../shared'
import { accountForContents, setActive, viewFor } from './accounts'
import { showWindow } from './window'
import { store } from './store'

export function installNotifications(): void {
  ipcMain.on('notify', (e, p: NotifyPayload) => {
    const acctId = accountForContents(e.sender.id)
    if (!acctId || !Notification.isSupported()) return
    const label = store.get('accounts').find((a) => a.id === acctId)?.label
    const n = new Notification({
      title: p.title === 'New mail' && label ? `New mail – ${label}` : p.title,
      subtitle: p.synthetic && label ? label : undefined,
      body: p.body ?? '',
      icon: p.icon?.startsWith('data:') ? nativeImage.createFromDataURL(p.icon) : undefined,
      silent: false
    })
    n.on('click', () => {
      setActive(acctId)
      showWindow()
      viewFor(acctId)?.webContents.send('notify-click', p.nid)
    })
    n.on('close', () => viewFor(acctId)?.webContents.send('notify-close', p.nid))
    n.show()
  })
}
