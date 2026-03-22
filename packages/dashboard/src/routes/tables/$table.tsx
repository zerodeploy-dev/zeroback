import { useState, useMemo, useCallback, useEffect } from "react"
import { useParams, useSearch, useNavigate } from "@tanstack/react-router"
import { useQuery, useMutation } from "@zeroback/react"
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { api, type DocRow, type TableInfo } from "../../lib/zeroback"
import { truncate, formatTimestamp } from "../../lib/utils"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { CellValue } from "../../components/CellValue"
import { DataTable } from "../../components/DataTable"
import { Pagination } from "../../components/Pagination"
import { DocumentPanel } from "../../components/DocumentPanel"
import { CreateDocumentDialog } from "../../components/CreateDocumentDialog"
import { Plus, Trash2 } from "lucide-react"

const emptyData: DocRow[] = []
const coreRowModel = getCoreRowModel()

export function TablePage() {
  const { table } = useParams({ from: "/tables/$table" })
  const { doc: viewDocId } = useSearch({ from: "/tables/$table" })
  const navigate = useNavigate()
  const schema = useQuery(api.getSchema)
  const [sorting, setSorting] = useState<SortingState>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([])
  const [showCreate, setShowCreate] = useState(false)

  const setViewDocId = useCallback((id: string | null) => {
    navigate({
      to: "/tables/$table",
      params: { table },
      search: id ? { doc: id } : {},
      replace: true,
    })
  }, [navigate, table])

  const deleteDocument = useMutation(api.deleteDocument)

  const sortField = sorting.length > 0 ? sorting[0].id : undefined
  const sortDirection = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : undefined

  const queryArgs = useMemo(() => ({
    table,
    cursor,
    numItems: 50,
    sort: sortField ? { field: sortField, direction: sortDirection! } : undefined,
  }), [table, cursor, sortField, sortDirection])

  const result = useQuery(api.listDocuments, queryArgs)

  const tableSchema: TableInfo | undefined = schema?.tables?.[table]
  const fieldsJson = tableSchema ? JSON.stringify(Object.keys(tableSchema.fields).sort()) : ""
  const fieldEntries = useMemo(
    () => Object.entries(tableSchema?.fields ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fieldsJson]
  )

  useEffect(() => {
    setCursor(null)
    setCursorStack([])
    setSorting([])
  }, [table])

  // ── Columns ──────────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<DocRow>[]>(() => {
    const cols: ColumnDef<DocRow>[] = [
      {
        id: "_id",
        accessorKey: "_id",
        header: "_id",
        size: 200,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {truncate(row.original._id, 30)}
          </span>
        ),
        enableSorting: true,
      },
      {
        id: "_creationTime",
        accessorKey: "_creationTime",
        header: "Created",
        size: 160,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(row.original._creationTime)}
          </span>
        ),
        enableSorting: true,
      },
    ]

    for (const [fieldName] of fieldEntries) {
      cols.push({
        id: fieldName,
        accessorKey: fieldName,
        header: fieldName,
        size: 160,
        enableSorting: true,
        cell: ({ row }) => <CellValue value={row.original[fieldName]} />,
      })
    }

    cols.push({
      id: "_actions",
      header: "",
      size: 50,
      enableResizing: false,
      cell: ({ row }) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete ${row.original._id}?`)) {
              deleteDocument({ id: row.original._id })
            }
          }}
          className="p-1 text-muted-foreground hover:text-destructive rounded"
          title="Delete document"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    })

    return cols
  }, [fieldEntries, deleteDocument])

  // ── Table instance ───────────────────────────────────────────────────────

  const data: DocRow[] = result?.page ?? emptyData

  const onSortingChange = useCallback((updater: SortingState | ((old: SortingState) => SortingState)) => {
    setSorting(updater)
    setCursor(null)
    setCursorStack([])
  }, [])

  const reactTable = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: coreRowModel,
    manualSorting: true,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
  })

  // ── Pagination ───────────────────────────────────────────────────────────

  const handleNextPage = useCallback(() => {
    if (result?.continueCursor) {
      setCursorStack((prev) => [...prev, cursor])
      setCursor(result.continueCursor)
    }
  }, [result?.continueCursor, cursor])

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      if (prev.length === 0) return prev
      setCursor(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [])

  // ── Loading / not found ──────────────────────────────────────────────────

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Table "{table}" not found</div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{table}</h2>
            <Badge variant="outline" className="text-[10px]">
              {fieldEntries.length} fields
            </Badge>
            {tableSchema.indexes && tableSchema.indexes.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {tableSchema.indexes.length} indexes
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Document
          </Button>
        </div>

        <DataTable
          table={reactTable}
          selectedRowId={viewDocId}
          onRowClick={(row) => setViewDocId(row._id)}
          onBackgroundClick={viewDocId ? () => setViewDocId(null) : undefined}
        />

        <Pagination
          page={cursorStack.length + 1}
          hasNext={!result?.isDone}
          hasPrev={cursorStack.length > 0}
          count={data.length}
          onNext={handleNextPage}
          onPrev={handlePrevPage}
        />

        {showCreate && tableSchema && (
          <CreateDocumentDialog
            table={table}
            schema={tableSchema.fields}
            open={showCreate}
            onOpenChange={setShowCreate}
          />
        )}
      </div>

      {viewDocId && tableSchema && (
        <DocumentPanel
          id={viewDocId}
          fields={tableSchema.fields}
          onClose={() => setViewDocId(null)}
        />
      )}
    </div>
  )
}
