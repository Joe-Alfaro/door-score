import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { ApiError } from './api'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Runs `fetcher` whenever `deps` change (and on `reload()`), ignoring stale responses.
 * `fetcher` itself is deliberately not a dependency so callers can pass inline closures.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(errorMessage(reason))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [...deps, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, loading, reload }
}

/** Calls `callback` every `ms` milliseconds; pass `null` to pause. */
export function useInterval(callback: () => void, ms: number | null) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    if (ms === null) return
    const id = window.setInterval(() => callbackRef.current(), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}
