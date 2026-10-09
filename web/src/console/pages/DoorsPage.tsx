import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import type { DataTableRowClickEvent, DataTableStateEvent, SortOrder } from 'primereact/datatable'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { Sidebar } from 'primereact/sidebar'
import { Tag } from 'primereact/tag'
import { getDoors, getTags, isRecord } from '../api'
import { DoorDetailPanel, ErrorPanel, PageHeader } from '../components'
import { DASH, num, yesNo } from '../format'
import { useApi, useDebounced } from '../hooks'
import type { DoorSummary, DoorsQuery } from '../types'

/** Fields the backend accepts in `sort`; other columns are display-only. */
const SORTABLE = new Set(['rank', 'door_score', 'address', 'net_value', 'months_since_deed'])
const PAGE_SIZES = [25, 50, 100]

interface TableState {
  first: number
  rows: number
  sortField: string
  sortOrder: SortOrder
}

function rowDoorId(data: unknown): string | null {
  return isRecord(data) && typeof data.door_id === 'string' ? data.door_id : null
}

function toOrder(sortOrder: SortOrder): 'asc' | 'desc' | undefined {
  if (sortOrder === 1) return 'asc'
  if (sortOrder === -1) return 'desc'
  return undefined
}

function tagsBody(door: DoorSummary) {
  return (
    <div className="console-tags">
      {door.tags.map((tag) => (
        <Tag key={tag} severity="info" value={tag} />
      ))}
    </div>
  )
}

export function DoorsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [table, setTable] = useState<TableState>({ first: 0, rows: 25, sortField: 'rank', sortOrder: 1 })
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [municipality, setMunicipality] = useState<string | null>(null)
  const debouncedSearch = useDebounced(search.trim(), 300)
  const selectedId = searchParams.get('door')

  const tags = useApi(() => getTags().catch(() => []), [])
  // One slim fetch to learn the municipalities present; the list endpoint has no facet API.
  const municipalities = useApi(async () => {
    const page = await getDoors({ limit: 5000, sort: 'rank' })
    return [...new Set(page.doors.map((door) => door.municipality))].sort()
  }, [])

  const query = useMemo<DoorsQuery>(
    () => ({
      limit: table.rows,
      offset: table.first,
      sort: table.sortField,
      order: toOrder(table.sortOrder),
      q: debouncedSearch || undefined,
      tag: selectedTags[0],
      municipality: municipality ?? undefined,
    }),
    [table, debouncedSearch, selectedTags, municipality],
  )
  const doors = useApi(() => getDoors(query), [query])

  // The API filters by a single tag; any additional selected tags narrow the loaded page client-side.
  const extraTags = selectedTags.slice(1)
  const visibleDoors = useMemo(() => {
    const rows = doors.data?.doors ?? []
    if (extraTags.length === 0) return rows
    return rows.filter((door) => extraTags.every((tag) => door.tags.includes(tag)))
  }, [doors.data, extraTags])

  function resetPage() {
    setTable((current) => ({ ...current, first: 0 }))
  }

  function handlePage(event: DataTableStateEvent) {
    setTable((current) => ({ ...current, first: event.first, rows: event.rows }))
  }

  function handleSort(event: DataTableStateEvent) {
    if (!SORTABLE.has(event.sortField)) return
    setTable((current) => ({ ...current, first: 0, sortField: event.sortField, sortOrder: event.sortOrder ?? 1 }))
  }

  function openDoor(event: DataTableRowClickEvent) {
    const doorId = rowDoorId(event.data)
    if (!doorId) return
    setSearchParams({ door: doorId })
  }

  function closeDoor() {
    setSearchParams({})
  }

  const tagOptions = (tags.data ?? []).map((entry) => ({ label: `${entry.tag} (${entry.count})`, value: entry.tag }))

  return (
    <>
      <PageHeader title="Doors" subtitle="Every scored single-family home. Click a row for the full evidence." />

      <div className="console-toolbar">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              resetPage()
            }}
            placeholder="Search address"
          />
        </span>
        <MultiSelect
          value={selectedTags}
          options={tagOptions}
          onChange={(event) => {
            setSelectedTags(Array.isArray(event.value) ? event.value.filter((value): value is string => typeof value === 'string') : [])
            resetPage()
          }}
          placeholder="Tags"
          display="chip"
          loading={tags.loading}
          style={{ minWidth: 220 }}
        />
        <Dropdown
          value={municipality}
          options={municipalities.data ?? []}
          onChange={(event) => {
            setMunicipality(typeof event.value === 'string' ? event.value : null)
            resetPage()
          }}
          placeholder="Municipality"
          showClear
          loading={municipalities.loading}
        />
        <span className="console-muted">
          {doors.data ? `${num(doors.data.total)} doors match` : ''}
          {extraTags.length > 0 ? ` · page narrowed by ${extraTags.join(', ')}` : ''}
        </span>
      </div>

      {doors.error ? <ErrorPanel message={doors.error} onRetry={doors.reload} /> : null}

      <DataTable
        value={visibleDoors}
        dataKey="door_id"
        size="small"
        className="console-clickable"
        lazy
        paginator
        first={table.first}
        rows={table.rows}
        rowsPerPageOptions={PAGE_SIZES}
        totalRecords={doors.data?.total ?? 0}
        onPage={handlePage}
        sortField={table.sortField}
        sortOrder={table.sortOrder}
        onSort={handleSort}
        loading={doors.loading}
        onRowClick={openDoor}
        emptyMessage="No doors match these filters"
      >
        <Column field="rank" header="Rank" sortable className="console-num" style={{ width: 70 }} />
        <Column field="door_score" header="Score" sortable className="console-num" style={{ width: 80 }} />
        <Column header="Pct" className="console-num" style={{ width: 70 }} body={(door: DoorSummary) => (door.door_score_pct === null || door.door_score_pct === undefined ? DASH : `${door.door_score_pct}`)} />
        <Column field="address" header="Address" sortable />
        <Column field="municipality" header="Municipality" />
        <Column header="Tags" body={tagsBody} />
        <Column field="year_built" header="Built" className="console-num" body={(door: DoorSummary) => door.year_built ?? DASH} />
        <Column field="net_value" header="Assessed" sortable className="console-num" body={(door: DoorSummary) => (door.net_value === null || door.net_value === undefined ? DASH : `$${num(door.net_value)}`)} />
        <Column field="months_since_deed" header="Deed (mo)" sortable className="console-num" body={(door: DoorSummary) => num(door.months_since_deed)} />
        <Column header="Owner occ." body={(door: DoorSummary) => yesNo(door.owner_occupied)} />
      </DataTable>

      <Sidebar visible={selectedId !== null} position="right" onHide={closeDoor} style={{ width: 'min(600px, 95vw)' }} className="console-portal" header={<span className="console-muted">Door evidence</span>}>
        {selectedId ? <DoorDetailPanel doorId={selectedId} /> : null}
      </Sidebar>
    </>
  )
}
