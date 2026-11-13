import type { Account, Service, ShellApi } from '../shared'

declare global {
  interface Window { mailwrap: ShellApi }
}
const api = window.mailwrap

let accounts: Account[] = []
let activeId: string | null = null
const unread = new Map<string, number>()

const $accounts = document.getElementById('accounts')!
const $empty = document.getElementById('empty')!
const $addDialog = document.getElementById('add-dialog') as HTMLDialogElement
const $settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement
const $ctx = document.getElementById('ctx')!
let ctxTarget: string | null = null
const $renameDialog = document.getElementById('rename-dialog') as HTMLDialogElement
let renameTarget: string | null = null
$renameDialog.querySelector('.cancel')!.addEventListener('click', () => $renameDialog.close('cancel'))
$renameDialog.addEventListener('close', () => {
  const v = ($renameDialog.querySelector('[name=label]') as HTMLInputElement).value.trim()
  if ($renameDialog.returnValue === 'ok' && renameTarget && v) api.renameAccount(renameTarget, v)
})

function initials(label: string): string {
  const parts = label.trim().split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2)).toUpperCase()
}

function render(): void {
  $accounts.replaceChildren(
    ...accounts.map((a, i) => {
      const b = document.createElement('button')
      b.className = `acct ${a.service}${a.id === activeId ? ' active' : ''}`
      b.textContent = initials(a.label)
      b.title = ''
      const lbl = document.createElement('span')
      lbl.className = 'lbl'
      lbl.textContent = `${a.label}  (Ctrl+${i + 1})`
      b.append(lbl)
      const n = unread.get(a.id) ?? 0
      if (n > 0) {
        const s = document.createElement('span')
        s.className = 'badge'
        s.textContent = n > 99 ? '99+' : String(n)
        b.append(s)
      }
      b.onclick = () => api.setActive(a.id)
      b.oncontextmenu = (e) => {
        e.preventDefault()
        ctxTarget = a.id
        $ctx.hidden = false
        $ctx.style.left = `${e.clientX}px`
        $ctx.style.top = `${Math.min(e.clientY, window.innerHeight - $ctx.offsetHeight - 8)}px`
      }
      return b
    })
  )
  $empty.hidden = accounts.length > 0
}

document.addEventListener('click', (e) => {
  if (!$ctx.contains(e.target as Node)) $ctx.hidden = true
})
$ctx.addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).dataset.act
  $ctx.hidden = true
  const id = ctxTarget
  if (!act || !id) return
  const a = accounts.find((x) => x.id === id)
  if (act === 'reload') api.reloadAccount(id)
  else if (act === 'up') api.moveAccount(id, -1)
  else if (act === 'down') api.moveAccount(id, 1)
  else if (act === 'rename') {
    const inp = $renameDialog.querySelector('[name=label]') as HTMLInputElement
    inp.value = a?.label ?? ''
    renameTarget = id
    $renameDialog.showModal()
  } else if (act === 'remove') {
    if (confirm(`Remove account "${a?.label}"? Its login session will be deleted.`)) api.removeAccount(id)
  }
})

document.getElementById('add')!.onclick = () => {
  ;($addDialog.querySelector('[name=label]') as HTMLInputElement).value = ''
  $addDialog.showModal()
}
$addDialog.querySelector('.cancel')!.addEventListener('click', () => $addDialog.close('cancel'))
$addDialog.addEventListener('close', () => {
  if ($addDialog.returnValue !== 'ok') return
  const fd = new FormData($addDialog.querySelector('form')!)
  api.addAccount(fd.get('service') as Service, String(fd.get('label')))
})

document.getElementById('settings')!.onclick = async () => {
  const s = await api.getSettings()
  const f = $settingsDialog.querySelector('form')!
  ;(f.elements.namedItem('startMinimized') as HTMLInputElement).checked = s.startMinimized
  ;(f.elements.namedItem('autostart') as HTMLInputElement).checked = s.autostart
  $settingsDialog.showModal()
}
$settingsDialog.querySelector('form')!.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement
  api.setSettings({ [t.name]: t.checked })
})

api.onAccounts((a) => {
  accounts = a
  render()
})
api.onActive((id) => {
  activeId = id
  render()
})
api.onUnread((id, n) => {
  unread.set(id, n)
  render()
})

Promise.all([api.getAccounts(), api.getActive()]).then(([a, id]) => {
  accounts = a
  activeId = id
  render()
})
