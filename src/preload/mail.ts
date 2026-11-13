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
    last = n
    if (isOutlook) ipcRenderer.send('debug', `title now: ${document.title}`)
    ipcRenderer.send('unread', n)
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
const unreadState = new Map<string, boolean>()
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
  for (const r of listRows()) {
    const id = rowId(r)
    if (!id) continue
    seenConv.add(id)
    unreadState.set(id, rowIsUnread(r))
  }
  primed = true
  ipcRenderer.send('debug', `outlook list primed with ${seenConv.size} rows`)
}
function inNotifiableFolder(): boolean {
  return !/\/(sentitems|drafts|deleteditems|junkemail|archive|notes|outbox)\b/i.test(location.pathname)
}
let scanTimer: ReturnType<typeof setTimeout> | null = null
let lastScanLog = 0
function scheduleScan(): void {
  if (scanTimer) return
  scanTimer = setTimeout(() => {
    scanTimer = null
    outlookScan()
    checkInboxCounter()
  }, 700)
}
function outlookScan(): void {
  const rows = listRows()
  if (!rows.length) return
  if (!primed) {
    primeSeen()
    return
  }
  const ids = rows.map(rowId)
  const firstSeen = ids.findIndex((id) => id && seenConv.has(id))
  const fresh = rows.filter((r, i) => ids[i] && !seenConv.has(ids[i]) && (firstSeen < 0 || i < firstSeen))
  const anyNew = rows.filter((_r, i) => ids[i] && !seenConv.has(ids[i]))
  // Folder switch / search / full re-render: most rows are new -> re-prime silently.
  if (anyNew.length > Math.max(5, rows.length / 2) || firstSeen < 0) {
    for (const id of ids) if (id) seenConv.add(id)
    ipcRenderer.send('debug', `outlook list re-rendered (${anyNew.length}/${rows.length} new), re-primed`)
    return
  }
  for (const id of ids) if (id) seenConv.add(id)
  // Known conversations that just turned unread (a reply arrived in an existing thread).
  const flipped: HTMLElement[] = []
  rows.forEach((r, i) => {
    const id = ids[i]
    if (!id) return
    const u = rowIsUnread(r)
    const was = unreadState.get(id)
    if (was === false && u && i < 5 && !fresh.includes(r)) flipped.push(r)
    unreadState.set(id, u)
  })
  if (anyNew.length || flipped.length || Date.now() - lastScanLog > 30000) {
    lastScanLog = Date.now()
    const top = rows.slice(0, 3).map((r, i) => `#${i} ${seenConv.has(ids[i]) ? 'seen' : 'NEW'} ${rowIsUnread(r) ? 'unread' : 'read'} "${(r.getAttribute('aria-label') ?? r.innerText).replace(/\s+/g, ' ').slice(0, 50)}"`)
    ipcRenderer.send('debug', `scan rows=${rows.length} new=${anyNew.length} fresh=${fresh.length} flipped=${flipped.length} folderOk=${inNotifiableFolder()} top: ${top.join(' | ')}`)
  }
  if (!inNotifiableFolder()) return
  for (const r of [...fresh, ...flipped]) {
    if (!rowIsUnread(r)) continue
    const nid = synthSeq++
    synthetic.set(nid, rowId(r))
    const text = rowText(r)
    ipcRenderer.send('debug', `synthetic notification: ${text}`)
    lastRowNotify = Date.now()
    ipcRenderer.send('notify', { nid, title: 'New mail', body: text } as NotifyPayload)
  }
}
// Fallback: Inbox unread counter in the folder pane. Covers mail that lands in a tab we do not
// watch (Focused Inbox "Other") or arrives while the list is not rendered.
let inboxUnread = -1
let lastRowNotify = 0
let dumped = false
function dumpPane(): void {
  if (dumped) return
  const tree = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]')).slice(0, 12)
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).slice(0, 12)
  if (!tree.length && !tabs.length) return
  dumped = true
  const fmt = (e: HTMLElement): string =>
    `<${e.tagName.toLowerCase()} aria-label="${e.getAttribute('aria-label') ?? ''}" title="${e.getAttribute('title') ?? ''}"> "${(e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}"`
  ipcRenderer.send('debug', `pane treeitems: ${tree.map(fmt).join(' | ')}`)
  ipcRenderer.send('debug', `pane tabs: ${tabs.map(fmt).join(' | ')}`)
}
function inboxCounter(): number {
  dumpPane()
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  for (const it of items) {
    const title = it.getAttribute('title') ?? ''
    if (!/(Skrzynka odbiorcza|Inbox|Posteingang|Boîte de réception|Bandeja de entrada)/i.test(title)) continue
    // "Elementy: Skrzynka odbiorcza – 8377 (nieprzeczytane: 5202)" / "Inbox – 8377 (unread: 5202)"
    const m = title.match(/(nieprzeczytane|nieprzeczytanych|unread|ungelesen|non lus?|no le[ií]d[oa]s?)\D{0,3}(\d+)/i)
    if (m) return Number(m[2])
    const t = (it.textContent ?? '').match(/(\d+)\s*[—-]/)
    return t ? Number(t[1]) : 0
  }
  return -1
}
function checkInboxCounter(): void {
  const n = inboxCounter()
  if (n < 0) return
  if (inboxUnread < 0) {
    inboxUnread = n
    ipcRenderer.send('debug', `inbox counter primed: ${n}`)
    return
  }
  if (n > inboxUnread) {
    const delta = n - inboxUnread
    ipcRenderer.send('debug', `inbox counter ${inboxUnread} -> ${n}`)
    // If the row watcher just notified, assume it covered this increase.
    if (Date.now() - lastRowNotify > 5000) {
      const nid = synthSeq++
      ipcRenderer.send('notify', { nid, title: 'New mail', body: `${delta} new message${delta > 1 ? 's' : ''}` } as NotifyPayload)
    }
  }
  inboxUnread = n
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
    // Prime the seen-set once the list has rendered so existing mail never notifies,
    // then watch the DOM for rows inserted above the known ones.
    new MutationObserver(() => scheduleScan()).observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => outlookScan(), 500)
    setInterval(() => {
      outlookScan()
      checkInboxCounter()
    }, 20000)
  }
  report()
  const t = document.querySelector('title')
  if (t) new MutationObserver(report).observe(t, { childList: true, characterData: true, subtree: true })
  const h = document.querySelector('head')
  if (h) new MutationObserver(report).observe(h, { childList: true })
  setInterval(report, 15000)
})
