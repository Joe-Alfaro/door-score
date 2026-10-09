import { useEffect, useRef } from 'react'

interface TerminalProps {
  lines: string[]
  /** When true, the view sticks to the newest line as output arrives. */
  follow?: boolean
}

export function Terminal({ lines, follow = true }: TerminalProps) {
  const ref = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!follow || !ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, follow])

  return (
    <pre className="console-terminal" ref={ref} aria-live="polite">
      {lines.length === 0 ? 'Waiting for output…' : lines.join('\n')}
    </pre>
  )
}
