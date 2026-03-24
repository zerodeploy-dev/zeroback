import { useState, useRef, useCallback } from "react"
import { useAction } from "@zeroback/react"
import { api } from "../../lib/zeroback"
import { Button } from "../../components/ui/button"
import { Badge } from "../../components/ui/badge"
import { Play } from "lucide-react"

type QueryResult = {
  rows: Record<string, unknown>[]
  columns: string[]
  duration?: number
  error?: string
  query: string
}

export function SqlPage() {
  console.log("[render] SqlPage")
  const [query, setQuery] = useState("SELECT name, type FROM sqlite_master WHERE type = 'table' ORDER BY name")
  const [results, setResults] = useState<QueryResult[]>([])
  const [running, setRunning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runSQL = useAction(api.runSQL)

  const runQuery = useCallback(async () => {
    const q = query.trim()
    if (!q) return

    setRunning(true)
    const start = performance.now()

    try {
      const res = await runSQL({ query: q })
      const duration = Math.round(performance.now() - start)
      setResults((prev) => [
        { rows: res.rows, columns: res.columns, duration, query: q },
        ...prev,
      ])
    } catch (e) {
      const duration = Math.round(performance.now() - start)
      setResults((prev) => [
        { rows: [], columns: [], duration, error: e instanceof Error ? e.message : "Unknown error", query: q },
        ...prev,
      ])
    } finally {
      setRunning(false)
    }
  }, [query, runSQL])

  return (
    <div className="flex flex-col h-full">
      {/* Editor */}
      <div className="border-b border-border p-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">SQL Console</h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              SELECT only
            </Badge>
            <Button
              size="sm"
              onClick={runQuery}
              disabled={running || !query.trim()}
            >
              <Play className="w-3.5 h-3.5" />
              {running ? "Running…" : "Run"}
            </Button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              runQuery()
            }
          }}
          className="w-full h-28 bg-background border border-input rounded-md p-3 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="SELECT * FROM ..."
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Cmd+Enter</kbd> to run
        </p>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {results.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-sm">Run a query to see results</p>
          </div>
        )}

        {results.map((result, i) => (
          <div key={i} className="border-b border-border">
            <div className="flex items-center gap-2 px-4 py-2 bg-card/50 text-xs">
              {result.error ? (
                <Badge variant="destructive" className="text-[10px]">Error</Badge>
              ) : (
                <Badge variant="success" className="text-[10px]">
                  {result.rows.length} row{result.rows.length !== 1 ? "s" : ""}
                </Badge>
              )}
              {result.duration !== undefined && (
                <span className="text-muted-foreground tabular-nums">{result.duration}ms</span>
              )}
              <span className="text-muted-foreground font-mono truncate ml-2 max-w-md">
                {result.query}
              </span>
            </div>

            {result.error ? (
              <div className="px-4 py-3 text-sm text-destructive font-mono">
                {result.error}
              </div>
            ) : result.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {result.columns.map((col) => (
                        <th
                          key={col}
                          className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap border-b border-border"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border/30 hover:bg-accent/20">
                        {result.columns.map((col) => (
                          <td key={col} className="px-3 py-1.5 text-xs font-mono whitespace-nowrap max-w-sm truncate">
                            {formatSqlValue(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No rows returned
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
