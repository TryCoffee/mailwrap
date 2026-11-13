import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('mailwrapAuth', {
  info: () => ipcRenderer.invoke('auth:info'),
  submit: (u: string, p: string, remember: boolean) => ipcRenderer.send('auth:submit', u, p, remember),
  cancel: () => ipcRenderer.send('auth:cancel')
})
