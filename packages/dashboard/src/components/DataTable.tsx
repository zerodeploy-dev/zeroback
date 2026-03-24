import { flexRender, type Table as ReactTable } from "@tanstack/react-table"
import { cn } from "../lib/utils"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"

export function DataTable<T>({
  table,
  selectedRowId,
  onRowClick,
  onBackgroundClick,
}: {
  table: ReactTable<T>
  selectedRowId?: string
  onRowClick?: (row: T) => void
  onBackgroundClick?: () => void
}) {
  return (
    <div
      className="flex-1 overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && onBackgroundClick) onBackgroundClick()
      }}
    >
      <table className="border-collapse text-sm" style={{ width: table.getCenterTotalSize() }}>
        <thead className="sticky top-0 bg-card z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    "relative text-left px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground whitespace-nowrap",
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
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-primary/50",
                        header.column.getIsResizing() && "bg-primary"
                      )}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td
                colSpan={table.getAllColumns().length}
                className="text-center py-12 text-muted-foreground text-sm"
              >
                No documents
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => {
            const rowId = (row.original as Record<string, unknown>)._id as string | undefined
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border/50 hover:bg-accent/30 transition-colors",
                  onRowClick && "cursor-pointer",
                  selectedRowId && rowId === selectedRowId && "bg-accent/40"
                )}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 text-sm overflow-hidden text-ellipsis"
                    style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
