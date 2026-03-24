import { truncate } from "../lib/utils"
import { Badge } from "./ui/badge"

export function CellValue({ value }: { value: unknown }) {
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
