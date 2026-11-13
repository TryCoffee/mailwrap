declare global {
  interface Window { mailwrapAuth: { info(): Promise<{ host: string; realm: string; scheme: string; username: string; canRemember: boolean }>; submit(u: string, p: string, remember: boolean): void; cancel(): void } }
}
const api = window.mailwrapAuth
api.info().then((i) => {
  document.getElementById('host')!.textContent = `${i.host} (${i.scheme}${i.realm ? `, ${i.realm}` : ''})`
  const u = document.querySelector<HTMLInputElement>('[name=username]')!
  if (i.username) {
    u.value = i.username
    document.querySelector<HTMLInputElement>('[name=password]')!.focus()
  }
  if (!i.canRemember) (document.getElementById('remember-row') as HTMLElement).hidden = true
})
document.getElementById('f')!.addEventListener('submit', (e) => {
  e.preventDefault()
  const fd = new FormData(e.target as HTMLFormElement)
  api.submit(String(fd.get('username')), String(fd.get('password')), fd.get('remember') === 'on')
})
document.getElementById('cancel')!.onclick = () => api.cancel()
window.addEventListener('keydown', (e) => e.key === 'Escape' && api.cancel())
export {}
