import { useState, useEffect, useRef } from "react"
import { useQuery } from "@zeroback/react"
import { api, type ValidatorInfo, type DocRow } from "../lib/zeroback"
import { cn, truncate } from "../lib/utils"

export function getInnerValidator(validator: ValidatorInfo): { isOptional: boolean; inner: ValidatorInfo } {
  const isOptional = validator.type === "optional"
  return { isOptional, inner: isOptional ? (validator.value ?? validator) : validator }
}

export function getInnerType(validator: ValidatorInfo): { isOptional: boolean; innerType: string } {
  const { isOptional, inner } = getInnerValidator(validator)
  return { isOptional, innerType: inner.type }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findLabelField(tableFields: Record<string, ValidatorInfo> | undefined): string | null {
  if (!tableFields) return null
  for (const name of ["name", "title", "label", "text", "subject", "body"]) {
    if (tableFields[name]?.type === "string") return name
    if (tableFields[name]?.type === "optional" && tableFields[name]?.value?.type === "string") return name
  }
  for (const [name, v] of Object.entries(tableFields)) {
    if (v.type === "string") return name
    if (v.type === "optional" && v.value?.type === "string") return name
  }
  return null
}

function getDocLabel(doc: DocRow, labelField: string | null): string | null {
  if (!labelField) return null
  const val = doc[labelField]
  if (typeof val === "string" && val) return val
  return null
}

// ── AutoGrowTextarea ─────────────────────────────────────────────────────────

function AutoGrowTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }, [props.value])

  return <textarea ref={ref} {...props} rows={1} style={{ ...props.style, overflow: "hidden" }} />
}

// ── IdPicker ─────────────────────────────────────────────────────────────────

function IdPicker({
  value,
  tableName,
  isOptional,
  onChange,
}: {
  value: unknown
  tableName: string
  isOptional: boolean
  onChange: (val: unknown) => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const schema = useQuery(api.getSchema)
  const result = useQuery(api.listDocuments, { table: tableName, numItems: 50 })
  const docs = result?.page ?? []

  const labelField = findLabelField(schema?.tables?.[tableName]?.fields)

  const filtered = search
    ? docs.filter((d) => {
        const q = search.toLowerCase()
        if (d._id.toLowerCase().includes(q)) return true
        const label = getDocLabel(d, labelField)
        return label ? label.toLowerCase().includes(q) : false
      })
    : docs

  const currentValue = value === undefined || value === null ? "" : String(value)
  const currentDoc = docs.find((d) => d._id === currentValue)
  const currentLabel = currentDoc ? getDocLabel(currentDoc, labelField) : null
  const displayValue = currentLabel ? `${currentLabel}` : currentValue

  return (
    <div className="relative">
      <input
        value={open ? search : displayValue}
        onChange={(e) => {
          setSearch(e.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={() => {
          setSearch("")
          setOpen(true)
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
        }}
        placeholder={isOptional ? "(optional)" : `Select ${tableName}…`}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-md border border-border bg-card shadow-lg">
          {isOptional && (
            <button
              className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(undefined); setOpen(false) }}
            >
              — none —
            </button>
          )}
          {filtered.map((doc) => {
            const label = getDocLabel(doc, labelField)
            return (
              <button
                key={doc._id}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm hover:bg-accent/50 truncate",
                  doc._id === currentValue && "bg-accent/30"
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(doc._id); setOpen(false) }}
              >
                {label ? (
                  <span>
                    <span>{label}</span>
                    <span className="text-muted-foreground font-mono text-xs ml-2">{truncate(doc._id, 20)}</span>
                  </span>
                ) : (
                  <span className="font-mono">{doc._id}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── FieldEditor ──────────────────────────────────────────────────────────────

export function FieldEditor({
  value,
  validator,
  onChange,
}: {
  value: unknown
  validator: ValidatorInfo
  onChange: (val: unknown) => void
}) {
  const { isOptional, inner } = getInnerValidator(validator)
  const innerType = inner.type

  if (innerType === "id") {
    const tableName = (inner.tableName as string) ?? ""
    return (
      <IdPicker
        value={value}
        tableName={tableName}
        isOptional={isOptional}
        onChange={onChange}
      />
    )
  }

  if (innerType === "boolean") {
    return (
      <select
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          if (e.target.value === "" && isOptional) onChange(undefined)
          else onChange(e.target.value === "true")
        }}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
      >
        {isOptional && <option value="">— none —</option>}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }

  if (innerType === "number" || innerType === "float64" || innerType === "int64") {
    return (
      <input
        type="number"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => {
          if (e.target.value === "" && isOptional) onChange(undefined)
          else if (innerType === "int64") onChange(parseInt(e.target.value, 10))
          else onChange(Number(e.target.value))
        }}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono"
      />
    )
  }

  if (innerType === "object" || innerType === "array") {
    const text = value === undefined || value === null ? "" : JSON.stringify(value, null, 2)
    return (
      <AutoGrowTextarea
        value={text}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)) } catch { /* ignore invalid JSON while typing */ }
        }}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono resize-y"
      />
    )
  }

  const text = value === undefined || value === null ? "" : String(value)
  return (
    <AutoGrowTextarea
      value={text}
      onChange={(e) => {
        if (e.target.value === "" && isOptional) onChange(undefined)
        else onChange(e.target.value)
      }}
      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
    />
  )
}
