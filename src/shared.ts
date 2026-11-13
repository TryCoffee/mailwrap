export type Service = 'gmail' | 'outlook' | 'outlook365'

export interface Account {
  id: string
  service: Service
  label: string
}

export const SERVICE_URL: Record<Service, string> = {
  gmail: 'https://mail.google.com/mail/u/0/',
  outlook: 'https://outlook.live.com/mail/',
  outlook365: 'https://outlook.office.com/mail/'
}

export const SERVICE_NAME: Record<Service, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook.com',
  outlook365: 'Outlook 365'
}

/** Hosts that stay inside the account view; everything else opens in the system browser. */
export const INTERNAL_HOST_RE =
  /(^|\.)(google\.com|googleusercontent\.com|gstatic\.com|live\.com|office\.com|office365\.com|microsoft\.com|microsoftonline\.com|microsoftonline-p\.com|outlook\.com|msauth\.net|msftauth\.net|msidentity\.com|live\.net|windows\.net|sharepoint\.com|sharepointonline\.com|office\.net|cloud\.microsoft|msocdn\.com|azureedge\.net|microsoftpersonalcontent\.com|onedrive\.com|bing\.com)$/i

/** Hosts allowed to open as a popup window (OAuth / account chooser flows). */
export const AUTH_HOST_RE =
  /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|account\.microsoft\.com|account\.live\.com)$/i

/** Hosts that are the mail apps themselves; must always render inside the account view. */
export const MAIL_HOST_RE = /^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|outlook\.cloud\.microsoft)$/i

export interface NotifyPayload {
  nid: number
  title: string
  body?: string
  icon?: string
  tag?: string
  /** Produced by the app from the message list (Outlook), not by the page. */
  synthetic?: boolean
}

export interface Settings {
  startMinimized: boolean
  autostart: boolean
}

export interface ShellApi {
  getAccounts(): Promise<Account[]>
  getActive(): Promise<string | null>
  addAccount(service: Service, label: string): Promise<Account>
  removeAccount(id: string): Promise<void>
  renameAccount(id: string, label: string): Promise<void>
  moveAccount(id: string, dir: -1 | 1): Promise<void>
  setActive(id: string): Promise<void>
  reloadAccount(id: string): Promise<void>
  contextMenu(id: string, x: number, y: number): void
  overlay(open: boolean): void
  forgetAuth(): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(s: Partial<Settings>): Promise<Settings>
  onAccounts(cb: (a: Account[]) => void): void
  onActive(cb: (id: string | null) => void): void
  onUnread(cb: (id: string, n: number) => void): void
  onSidebarVisible(cb: (visible: boolean) => void): void
  onRename(cb: (id: string) => void): void
}
