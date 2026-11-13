import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('mailwrapAuth', {
  info: () => ipcRenderer.invoke('auth:info'),
  submit: (u: string, p: string) => ipcRenderer.send('auth:submit', u, p),
  cancel: () => ipcRenderer.send('auth:cancel')
})
