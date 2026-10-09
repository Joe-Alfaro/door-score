// The run token is never baked into the bundle: it is pasted once in the UI and kept in
// localStorage. VITE_CONSOLE_TOKEN remains a local-dev convenience only.
const KEY = 'door-score-console-token'

export function getConsoleToken(): string {
  return window.localStorage.getItem(KEY) ?? import.meta.env.VITE_CONSOLE_TOKEN ?? ''
}

export function setConsoleToken(value: string): void {
  if (value.trim()) {
    window.localStorage.setItem(KEY, value.trim())
  } else {
    window.localStorage.removeItem(KEY)
  }
  window.dispatchEvent(new Event('console-token-changed'))
}
