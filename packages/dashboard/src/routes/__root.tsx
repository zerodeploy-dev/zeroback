import { Outlet, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router"
import { useQuery, useConnectionState } from "@zeroback/react"
import { api, type SchemaResult } from "../lib/zeroback"
import { cn } from "../lib/utils"
import {
  Database,
  Table2,
  Terminal,
  LayoutDashboard,
  Wifi,
  WifiOff,
  Loader2,
} from "lucide-react"

function TableCountBadge({ table }: { table: string }) {
  const count = useQuery(api.getTableCount, { table })
  if (count == null) return null
  return (
    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
      {count.toLocaleString()}
    </span>
  )
}

function Sidebar() {
  const schema = useQuery(api.getSchema)
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const tables = schema ? Object.keys(schema.tables).sort() : []

  return (
    <aside className="w-56 border-r border-border flex flex-col bg-card/50 shrink-0">
      {/* Logo */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-border">
        <Database className="w-5 h-5 text-primary" />
        <span className="font-semibold text-sm">Zeroback</span>
        <span className="text-xs text-muted-foreground ml-auto">Dashboard</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <NavItem
          href="#/"
          icon={<LayoutDashboard className="w-4 h-4" />}
          label="Overview"
          active={currentPath === "/"}
        />

        <div className="mt-4 mb-1 px-2">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Tables
          </span>
        </div>

        {tables.map((table) => (
          <NavItem
            key={table}
            href={`#/tables/${encodeURIComponent(table)}`}
            icon={<Table2 className="w-4 h-4" />}
            label={table}
            active={currentPath === `/tables/${table}`}
          >
            <TableCountBadge table={table} />
          </NavItem>
        ))}

        {tables.length === 0 && schema && (
          <p className="px-2 py-2 text-xs text-muted-foreground">No tables defined</p>
        )}

        <div className="mt-4 mb-1 px-2">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Tools
          </span>
        </div>

        <NavItem
          href="#/sql"
          icon={<Terminal className="w-4 h-4" />}
          label="SQL Console"
          active={currentPath === "/sql"}
        />
      </nav>

      {/* Connection status */}
      <ConnectionStatus />
    </aside>
  )
}

function NavItem({
  href,
  icon,
  label,
  active,
  children,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active: boolean
  children?: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {children}
    </a>
  )
}

function ConnectionStatus() {
  const state = useConnectionState()
  return (
    <div className="h-10 flex items-center gap-2 px-4 border-t border-border text-xs text-muted-foreground">
      {state === "connected" ? (
        <>
          <Wifi className="w-3 h-3 text-success" />
          <span>Connected</span>
        </>
      ) : state === "connecting" ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Connecting…</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-destructive" />
          <span>Disconnected</span>
        </>
      )}
    </div>
  )
}

export function RootLayout() {
  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
