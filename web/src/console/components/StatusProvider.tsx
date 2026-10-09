import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { getHealth, getStatus } from '../api'
import { useApi } from '../hooks'
import type { Health, Status } from '../types'

interface ConsoleStatus {
  status: Status | null
  health: Health | null
  loading: boolean
  error: string | null
  reload: () => void
}

const StatusContext = createContext<ConsoleStatus | null>(null)

/** Fetches /api/status and /api/health once for the header and the overview page. */
export function StatusProvider({ children }: { children: ReactNode }) {
  const status = useApi(getStatus, [])
  const health = useApi(getHealth, [])
  const value: ConsoleStatus = {
    status: status.data,
    health: health.data,
    loading: status.loading || health.loading,
    error: status.error ?? health.error,
    reload: () => {
      status.reload()
      health.reload()
    },
  }
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

export function useConsoleStatus(): ConsoleStatus {
  const value = useContext(StatusContext)
  if (!value) throw new Error('useConsoleStatus must be used inside StatusProvider')
  return value
}
