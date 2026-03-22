import { useQuery } from "@zeroback/react"
import { api, type ValidatorInfo, type TableInfo } from "../lib/zeroback"
import { validatorTypeLabel } from "../lib/utils"
import { Badge } from "../components/ui/badge"
import { Table2, ArrowRight } from "lucide-react"

function TableCard({ name, fields, indexes }: {
  name: string
  fields: Record<string, ValidatorInfo>
  indexes: { name: string; fields: string[] }[]
}) {
  const count = useQuery(api.getTableCount, { table: name })
  const fieldEntries = Object.entries(fields)

  return (
    <a
      href={`#/tables/${encodeURIComponent(name)}`}
      className="group block border border-border rounded-lg p-4 hover:border-primary/50 transition-colors bg-card"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Table2 className="w-4 h-4 text-primary" />
          <h3 className="font-medium">{name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {count !== undefined && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {count.toLocaleString()} rows
            </span>
          )}
          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <div className="space-y-1">
        {fieldEntries.map(([fieldName, validator]) => (
          <div key={fieldName} className="flex items-center gap-2 text-xs">
            <span className="text-foreground font-mono">{fieldName}</span>
            <span className="text-muted-foreground">{validatorTypeLabel(validator)}</span>
          </div>
        ))}
      </div>

      {indexes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {indexes.map((idx) => (
            <Badge key={idx.name} variant="outline" className="text-[10px]">
              {idx.name}
            </Badge>
          ))}
        </div>
      )}
    </a>
  )
}

export function OverviewPage() {
  console.log("[render] OverviewPage")
  const schema = useQuery(api.getSchema)

  if (!schema) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading schema…</div>
      </div>
    )
  }

  const tables: Record<string, TableInfo> = schema.tables

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {Object.keys(tables).length} table{Object.keys(tables).length !== 1 ? "s" : ""} in schema
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Object.entries(tables).map(([name, info]) => (
          <TableCard
            key={name}
            name={name}
            fields={info.fields}
            indexes={info.indexes ?? []}
          />
        ))}
      </div>
    </div>
  )
}
