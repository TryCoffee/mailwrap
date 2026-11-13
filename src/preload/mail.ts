import { ipcRenderer, webFrame } from 'electron'
import type { NotifyPayload } from '../shared'

// --- Notification shim -----------------------------------------------------
// Runs in the page's main world so Gmail/Outlook's `new Notification(...)` reaches us.
// We relay to the main process which shows a native notification and sends click/close back.

ipcRenderer.on('notify-click', (_e, nid: number) => {
  webFrame.executeJavaScript(`window.__mailwrapNotify && window.__mailwrapNotify.click(${nid})`).catch(() => undefined)
})
ipcRenderer.on('notify-close', (_e, nid: number) => {
  webFrame.executeJavaScript(`window.__mailwrapNotify && window.__mailwrapNotify.close(${nid})`).catch(() => undefined)
})

const shim = `(() => {
  if (window.__mailwrapNotify) return;
  const live = new Map();
  let seq = 0;
  class MailwrapNotification extends EventTarget {
    constructor(title, options = {}) {
      super();
      this.title = title;
      this.body = options.body;
      this.icon = options.icon;
      this.tag = options.tag;
      this.data = options.data;
      this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
      this._nid = ++seq;
      live.set(this._nid, this);
      window.postMessage({ __mailwrap: 'notify', nid: this._nid, title, body: options.body, icon: options.icon, tag: options.tag }, '*');
      setTimeout(() => { const ev = new Event('show'); this.onshow && this.onshow(ev); this.dispatchEvent(ev); }, 0);
    }
    close() { live.delete(this._nid); }
    static get permission() { return 'granted'; }
    static requestPermission(cb) { window.postMessage({ __mailwrap: 'debug', msg: 'Notification.requestPermission called' }, '*'); const p = Promise.resolve('granted'); if (cb) p.then(cb); return p; }
    static get maxActions() { return 0; }
  }
  window.Notification = MailwrapNotification;
  // Persistent notifications (registration.showNotification) are not displayed by Electron; route
  // page-side calls through the same shim.
  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      window.postMessage({ __mailwrap: 'debug', msg: 'showNotification via ServiceWorkerRegistration' }, '*');
      new MailwrapNotification(title, options);
      return Promise.resolve();
    };
  }
  if (navigator.permissions && navigator.permissions.query) {
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => q(d).then((r) => { if (d && d.name === 'notifications') window.postMessage({ __mailwrap: 'debug', msg: 'permissions.query(notifications) -> ' + r.state }, '*'); return r; });
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((reg) => window.postMessage({ __mailwrap: 'debug', msg: 'service worker ready: ' + reg.scope }, '*')).catch(() => {});
  }
  window.__mailwrapNotify = {
    click(nid) { const n = live.get(nid); if (!n) return; window.focus(); const ev = new Event('click'); n.onclick && n.onclick(ev); n.dispatchEvent(ev); live.delete(nid); },
    close(nid) { const n = live.get(nid); if (!n) return; const ev = new Event('close'); n.onclose && n.onclose(ev); n.dispatchEvent(ev); live.delete(nid); }
  };
})();`

webFrame.executeJavaScript(shim).catch(() => undefined)

window.addEventListener('message', (ev) => {
  const d = ev.data
  if (ev.source !== window || !d) return
  if (d.__mailwrap === 'debug') {
    ipcRenderer.send('debug', d.msg)
    return
  }
  if (d.__mailwrap !== 'notify') return
  ipcRenderer.send('debug', `Notification created: "${d.title}" / ${d.body ?? ''}`)
  const p: NotifyPayload = { nid: d.nid, title: String(d.title ?? ''), body: d.body, icon: d.icon, tag: d.tag }
  ipcRenderer.send('notify', p)
})

// --- Unread count from <title> --------------------------------------------
// Gmail: "Inbox (12) - user@gmail.com - Gmail"; Outlook: "(12) Mail - user - Outlook"
function parseUnread(title: string): number {
  const m = title.match(/\((\d+)\)/)
  return m ? Number(m[1]) : 0
}
let last = -1
function report(): void {
  const n = parseUnread(document.title)
  if (n !== last) {
    const prev = last
    last = n
    ipcRenderer.send('unread', n)
    if (isOutlook && prev >= 0 && n > prev) setTimeout(() => outlookScan(n - prev), 1500)
  }
}

// --- Outlook: synthesize notifications ------------------------------------
// New Outlook delivers new-mail notifications through a Web Push service worker (sw_webpush.js),
// which has no push service in Electron, so it never notifies. Instead, when the unread count
// rises we read the newest unread rows from the message list and raise notifications ourselves.
const isOutlook =
  /(^|\.)(outlook\.(live|office|office365)\.com|outlook\.cloud\.microsoft)$/i.test(location.hostname) ||
  process.argv.includes('--mailwrap-fake-outlook')
const seenConv = new Set<string>()
const synthetic = new Map<number, string>() // nid -> convid
let synthSeq = -1000000
let primed = false

function listRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-convid], [data-item-id]'))
}
function rowId(el: HTMLElement): string {
  return el.getAttribute('data-convid') ?? el.getAttribute('data-item-id') ?? ''
}
function rowIsUnread(el: HTMLElement): boolean {
  const label = (el.getAttribute('aria-label') ?? '').trim()
  if (/^(unread|nieprzeczytane|ungelesen|non lu|no le[ií]d)/i.test(label)) return true
  // fallback: OWA marks unread rows with a bold subject / an "unread" class somewhere inside
  return !!el.querySelector('[class*="nread" i], [class*="Unread"]')
}
function rowText(el: HTMLElement): string {
  const label = (el.getAttribute('aria-label') ?? '').trim()
  const cleaned = label.replace(/^(unread|nieprzeczytane|ungelesen|non lu|no le[ií]d[oa]s?)[\s,.:-]*/i, '')
  return (cleaned || el.innerText.replace(/\s+/g, ' ').trim()).slice(0, 240)
}
function primeSeen(): void {
  for (const r of listRows()) if (rowId(r)) seenConv.add(rowId(r))
  primed = true
}
function outlookScan(delta: number): void {
  if (!primed) {
    primeSeen()
    return
  }
  const rows = listRows()
  let fired = 0
  for (const r of rows) {
    const id = rowId(r)
    if (!id || seenConv.has(id)) continue
    seenConv.add(id)
    if (!rowIsUnread(r) || fired >= delta) continue
    fired++
    const nid = synthSeq++
    synthetic.set(nid, id)
    const text = rowText(r)
    const p: NotifyPayload = { nid, title: 'New mail', body: text }
    ipcRenderer.send('debug', `synthetic notification: ${text}`)
    ipcRenderer.send('notify', p)
  }
  if (fired === 0 && delta > 0) {
    const nid = synthSeq++
    ipcRenderer.send('notify', { nid, title: 'New mail', body: `${delta} new message${delta > 1 ? 's' : ''}` })
  }
}
ipcRenderer.on('notify-click', (_e, nid: number) => {
  const conv = synthetic.get(nid)
  if (!conv) return
  synthetic.delete(nid)
  const el = listRows().find((r) => rowId(r) === conv)
  el?.click()
})

window.addEventListener('DOMContentLoaded', () => {
  if (isOutlook) {
    // Prime the seen-set once the list has rendered so existing mail never notifies.
    const t = setInterval(() => {
      if (listRows().length) {
        primeSeen()
        clearInterval(t)
      }
    }, 2000)
    setTimeout(() => clearInterval(t), 120000)
  }
  report()
  const t = document.querySelector('title')
  if (t) new MutationObserver(report).observe(t, { childList: true, characterData: true, subtree: true })
  const h = document.querySelector('head')
  if (h) new MutationObserver(report).observe(h, { childList: true })
  setInterval(report, 15000)
})
