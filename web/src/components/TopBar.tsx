import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { TOP_N_OPTIONS } from '../types'
import type { DoorFeature, TagCount, TagFilter, TopN } from '../types'

interface TopBarProps {
  doors: DoorFeature[]
  /** Tags present in the loaded data, most common first. */
  tags: TagCount[]
  topN: TopN
  onTopNChange: (value: TopN) => void
  activeTags: ReadonlySet<TagFilter>
  onToggleTag: (tag: TagFilter) => void
  onPickDoor: (door: DoorFeature) => void
}

const MAX_RESULTS = 8

function parseTopN(value: string): TopN {
  const match = TOP_N_OPTIONS.find((option) => String(option) === value)
  return match ?? 'all'
}

export function TopBar({ doors, tags, topN, onTopNChange, activeTags, onToggleTag, onPickDoor }: TopBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []
    return doors
      .filter((door) => door.properties.address.toLowerCase().includes(needle))
      .sort((a, b) => a.properties.rank - b.properties.rank)
      .slice(0, MAX_RESULTS)
  }, [doors, query])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  function pick(door: DoorFeature) {
    onPickDoor(door)
    setQuery(door.properties.address)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key !== 'Enter') return
    const first = matches[0]
    if (first) pick(first)
  }

  return (
    <header className="top-bar">
      <h1 className="title">Door Score — Ramsey, NJ</h1>

      <div className="search" ref={wrapperRef}>
        <input
          type="search"
          className="search-input"
          placeholder="Search address…"
          aria-label="Search by address"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open && matches.length > 0 ? (
          <ul className="search-results" role="listbox">
            {matches.map((door) => (
              <li key={door.properties.door_id}>
                <button type="button" className="search-result" onClick={() => pick(door)}>
                  <span>{door.properties.address}</span>
                  <span className="muted">
                    #{door.properties.rank} · {door.properties.door_score}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {open && query.trim().length > 0 && matches.length === 0 ? (
          <div className="search-results search-empty muted">No matching addresses</div>
        ) : null}
      </div>

      <label className="control">
        <span className="control-label">Top</span>
        <select value={String(topN)} onChange={(event) => onTopNChange(parseTopN(event.target.value))}>
          {TOP_N_OPTIONS.map((option) => (
            <option key={String(option)} value={String(option)}>
              {option === 'all' ? 'All' : option}
            </option>
          ))}
        </select>
      </label>

      <div className="tag-toggles" role="group" aria-label="Tag filters">
        {tags.map(({ tag, count }) => {
          const active = activeTags.has(tag)
          return (
            <button
              key={tag}
              type="button"
              className={active ? 'toggle toggle-active' : 'toggle'}
              aria-pressed={active}
              title={`${count} doors`}
              onClick={() => onToggleTag(tag)}
            >
              {tag}
              <span className="toggle-count">{count}</span>
            </button>
          )
        })}
      </div>
    </header>
  )
}
