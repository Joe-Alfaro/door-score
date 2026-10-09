import { useEffect, useState } from 'react'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Password } from 'primereact/password'
import { getConsoleToken, setConsoleToken } from '../token'

export function TokenButton() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [hasToken, setHasToken] = useState(() => getConsoleToken() !== '')

  useEffect(() => {
    const sync = () => setHasToken(getConsoleToken() !== '')
    window.addEventListener('console-token-changed', sync)
    return () => window.removeEventListener('console-token-changed', sync)
  }, [])

  function save() {
    setConsoleToken(draft)
    setDraft('')
    setOpen(false)
  }

  return (
    <>
      <Button
        size="small"
        text
        icon={hasToken ? 'pi pi-unlock' : 'pi pi-lock'}
        label={hasToken ? 'Run token set' : 'Set run token'}
        severity={hasToken ? 'success' : 'secondary'}
        onClick={() => setOpen(true)}
      />
      <Dialog header="Console run token" visible={open} style={{ width: '26rem' }} onHide={() => setOpen(false)}>
        <p className="muted" style={{ marginTop: 0 }}>
          Reading data needs no token. Starting or cancelling a pipeline run sends this token as a header.
          It is stored only in this browser.
        </p>
        <Password
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          feedback={false}
          toggleMask
          inputStyle={{ width: '100%' }}
          style={{ width: '100%' }}
          placeholder="Paste CONSOLE_TOKEN"
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          {hasToken && <Button label="Clear" severity="danger" text onClick={() => { setConsoleToken(''); setOpen(false) }} />}
          <Button label="Save" onClick={save} disabled={!draft.trim()} />
        </div>
      </Dialog>
    </>
  )
}
