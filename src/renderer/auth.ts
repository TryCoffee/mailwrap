declare global {
  interface Window { mailwrapAuth: { info(): Promise<{ host: string; realm: string; scheme: string }>; submit(u: string, p: string): void; cancel(): void } }
}
const api = window.mailwrapAuth
api.info().then((i) => {
  document.getElementById('host')!.textContent = `${i.host} (${i.scheme}${i.realm ? `, ${i.realm}` : ''})`
})
document.getElementById('f')!.addEventListener('submit', (e) => {
  e.preventDefault()
  const fd = new FormData(e.target as HTMLFormElement)
  api.submit(String(fd.get('username')), String(fd.get('password')))
})
document.getElementById('cancel')!.onclick = () => api.cancel()
window.addEventListener('keydown', (e) => e.key === 'Escape' && api.cancel())
export {}
