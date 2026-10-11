// The active custom territory sticks across the map and the console until the user goes back to
// default. The URL (?territory=<id>) stays the shareable source of truth; localStorage fills it in
// whenever a link or a fresh visit arrives without it.
const KEY = 'door-score-active-territory'

export function readStoredTerritory(): string | null {
  return window.localStorage.getItem(KEY)
}

export function storeTerritory(id: string | null): void {
  if (id) {
    window.localStorage.setItem(KEY, id)
  } else {
    window.localStorage.removeItem(KEY)
  }
}
