import { createContext, useCallback, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { Toast } from 'primereact/toast'
import type { ToastMessage } from 'primereact/toast'

export type ShowToast = (message: ToastMessage) => void

const ToastContext = createContext<ShowToast | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const toastRef = useRef<Toast>(null)
  const show = useCallback<ShowToast>((message) => toastRef.current?.show(message), [])
  return (
    <ToastContext.Provider value={show}>
      <Toast ref={toastRef} position="top-right" className="console-portal" />
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside ToastProvider')
  return show
}
