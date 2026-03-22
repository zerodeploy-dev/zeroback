import { useState, useMemo } from "react"
import { useParams } from "@tanstack/react-router"
import { useQuery, useMutation } from "@zeroback/react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { api, type ValidatorInfo, type DocRow, type TableInfo } from "../../lib/zeroback"
import { cn, truncate, validatorTypeLabel, formatTimestamp } from "../../lib/utils"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { Input } from "../../components/ui/input"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../../components/ui/dialog"
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Save,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react"

function getInnerType(validator: ValidatorInfo): { isOptional: boolean; innerType: string } {
  const isOptional = validator.type === "optional"
  const innerType = isOptional ? (validator.value?.type ?? "string") : validator.type
  return { isOptional, innerType }
}

// ── Cell rendering ───────────────────────────────────────────────────────────

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50 italic">null</span>
  }
  if (typeof value === "boolean") {
    return (
      <Badge variant={value ? "success" : "secondary"} className="text-[10px]">
        {String(value)}
      </Badge>
    )
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{value.toLocaleString()}</span>
  }
  if (typeof value === "object") {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {truncate(JSON.stringify(value), 60)}
      </span>
    )
  }
  return <span>{truncate(String(value), 80)}</span>
}

// ── Inline cell editor ───────────────────────────────────────────────────────

function InlineEditor({
  value,
  validator,
  onSave,
  onCancel,
}: {
  value: unknown
  validator: ValidatorInfo
  onSave: (val: unknown) => void
  onCancel: () => void
}) {
  const { isOptional, innerType } = getInnerType(validator)

  const [text, setText] = useState(() => {
    if (value === null || value === undefined) return ""
    if (typeof value === "object") return JSON.stringify(value, null, 2)
    return String(value)
  })

  const handleSave = () => {
    let parsed: unknown = text
    if (innerType === "number" || innerType === "float64") {
      parsed = text === "" && isOptional ? undefined : Number(text)
    } else if (innerType === "int64") {
      parsed = text === "" && isOptional ? undefined : parseInt(text, 10)
    } else if (innerType === "boolean") {
      parsed = text === "true"
    } else if (innerType === "object" || innerType === "array") {
      try {
        parsed = JSON.parse(text)
      } catch {
        return // Don't save invalid JSON
      }
    } else if (innerType === "string" || innerType === "id") {
      parsed = text === "" && isOptional ? undefined : text
    }
    onSave(parsed)
  }

  if (innerType === "boolean") {
    return (
      <div className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={text === "true"}
          onChange={(e) => setText(String(e.target.checked))}
          className="accent-primary"
          autoFocus
        />
        <button onClick={handleSave} className="text-xs text-success hover:underline">Save</button>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave()
          if (e.key === "Escape") onCancel()
        }}
        className="h-7 text-xs min-w-[100px]"
        autoFocus
      />
      <button onClick={handleSave} className="p-1 text-success hover:text-success/80">
        <Save className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// ── Document detail dialog ───────────────────────────────────────────────────

function DocumentDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const doc = useQuery(api.getDocument, { id })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Document</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="font-mono text-xs mb-2 text-muted-foreground">{id}</div>
        <pre className="bg-background rounded-md p-4 text-xs overflow-auto max-h-[60vh] border border-border">
          {doc ? JSON.stringify(doc, null, 2) : "Loading…"}
        </pre>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

// ── Create document dialog ───────────────────────────────────────────────────

function CreateDocumentDialog({
  table,
  schema,
  open,
  onOpenChange,
}: {
  table: string
  schema: Record<string, ValidatorInfo>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const insertDocument = useMutation(api.insertDocument)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  const fieldEntries = Object.entries(schema)

  const handleCreate = async () => {
    setError("")
    try {
      const data: Record<string, unknown> = {}
      for (const [name, validator] of fieldEntries) {
        const raw = fields[name] ?? ""
        const { isOptional, innerType } = getInnerType(validator)

        if (raw === "" && isOptional) continue
        if (raw === "" && !isOptional) {
          setError(`Field "${name}" is required`)
          return
        }

        if (innerType === "number" || innerType === "float64") {
          data[name] = Number(raw)
        } else if (innerType === "int64") {
          data[name] = parseInt(raw, 10)
        } else if (innerType === "boolean") {
          data[name] = raw === "true"
        } else if (innerType === "object" || innerType === "array") {
          data[name] = JSON.parse(raw)
        } else {
          data[name] = raw
        }
      }

      await insertDocument({ table, data })
      setFields({})
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create document")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Document in {table}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          {fieldEntries.map(([name, validator]) => {
            const { isOptional, innerType } = getInnerType(validator)
            return (
              <div key={name}>
                <label className="block text-xs font-medium mb-1">
                  {name}
                  <span className="text-muted-foreground ml-1">
                    {validatorTypeLabel(validator)}
                  </span>
                </label>
                {innerType === "boolean" ? (
                  <select
                    value={fields[name] ?? ""}
                    onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    {isOptional && <option value="">— none —</option>}
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <Input
                    value={fields[name] ?? ""}
                    onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
                    placeholder={isOptional ? "(optional)" : ""}
                  />
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="text-destructive text-xs mt-3">{error}</p>}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button size="sm" onClick={handleCreate}>Create</Button>
      </DialogFooter>
    </Dialog>
  )
}

// ── Main table page ──────────────────────────────────────────────────────────

export function TablePage() {
  const { table } = useParams({ from: "/tables/$table" })
  const schema = useQuery(api.getSchema)
  const [sorting, setSorting] = useState<SortingState>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([])
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null)
  const [viewDocId, setViewDocId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const deleteDocument = useMutation(api.deleteDocument)
  const updateDocument = useMutation(api.updateDocument)

  // Derive sort from TanStack sorting state
  const sort = useMemo(() => {
    if (sorting.length === 0) return undefined
    const direction: "asc" | "desc" = sorting[0].desc ? "desc" : "asc"
    return { field: sorting[0].id, direction }
  }, [sorting])

  const result = useQuery(api.listDocuments, {
    table,
    cursor,
    numItems: 50,
    sort,
  })

  const tableSchema: TableInfo | undefined = schema?.tables?.[table]
  const fields = tableSchema?.fields ?? {}
  const fieldEntries = Object.entries(fields)

  // Reset pagination when table changes
  const [prevTable, setPrevTable] = useState(table)
  if (table !== prevTable) {
    setPrevTable(table)
    setCursor(null)
    setCursorStack([])
    setSorting([])
    setEditingCell(null)
  }

  // Build columns dynamically
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

    for (const [fieldName, validator] of fieldEntries) {
      cols.push({
        id: fieldName,
        accessorKey: fieldName,
        header: fieldName,
        size: 160,
        enableSorting: true,
        cell: ({ row }) => {
          const isEditing =
            editingCell?.rowId === row.original._id &&
            editingCell?.field === fieldName

          if (isEditing) {
            return (
              <InlineEditor
                value={row.original[fieldName]}
                validator={validator}
                onSave={async (val) => {
                  await updateDocument({
                    id: row.original._id,
                    fields: { [fieldName]: val },
                  })
                  setEditingCell(null)
                }}
                onCancel={() => setEditingCell(null)}
              />
            )
          }

          return (
            <div
              className="cursor-pointer hover:bg-accent/50 -m-1 p-1 rounded"
              onDoubleClick={() =>
                setEditingCell({ rowId: row.original._id, field: fieldName })
              }
            >
              <CellValue value={row.original[fieldName]} />
            </div>
          )
        },
      })
    }

    // Actions column
    cols.push({
      id: "_actions",
      header: "",
      size: 80,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewDocId(row.original._id)}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            title="View document"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={async () => {
              if (confirm(`Delete ${row.original._id}?`)) {
                await deleteDocument({ id: row.original._id })
              }
            }}
            className="p-1 text-muted-foreground hover:text-destructive rounded"
            title="Delete document"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    })

    return cols
  }, [fieldEntries, editingCell, updateDocument, deleteDocument])

  const data: DocRow[] = result?.page ?? []

  const reactTable = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(updater)
      setCursor(null)
      setCursorStack([])
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  })

  const handleNextPage = () => {
    if (result?.continueCursor) {
      setCursorStack([...cursorStack, cursor])
      setCursor(result.continueCursor)
    }
  }

  const handlePrevPage = () => {
    if (cursorStack.length > 0) {
      const prev = cursorStack[cursorStack.length - 1]
      setCursorStack(cursorStack.slice(0, -1))
      setCursor(prev)
    }
  }

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-card z-10">
            {reactTable.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "text-left px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground whitespace-nowrap",
                      header.column.getCanSort() && "cursor-pointer select-none hover:text-foreground"
                    )}
                    style={{ width: header.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        header.column.getIsSorted() === "asc" ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
                        )
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-muted-foreground text-sm">
                  {result === undefined ? "Loading…" : "No documents"}
                </td>
              </tr>
            )}
            {reactTable.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 text-sm"
                    style={{ maxWidth: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 h-10 border-t border-border shrink-0 text-xs text-muted-foreground">
        <span>
          {data.length} document{data.length !== 1 ? "s" : ""} on this page
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={cursorStack.length === 0}
            onClick={handlePrevPage}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span>Page {cursorStack.length + 1}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={result?.isDone}
            onClick={handleNextPage}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      {viewDocId && (
        <DocumentDialog
          id={viewDocId}
          open={!!viewDocId}
          onOpenChange={(open) => !open && setViewDocId(null)}
        />
      )}
      <CreateDocumentDialog
        table={table}
        schema={fields}
        open={showCreate}
        onOpenChange={setShowCreate}
      />
    </div>
  )
}
