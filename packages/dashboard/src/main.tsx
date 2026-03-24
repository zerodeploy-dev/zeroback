import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter, createRootRoute, createRoute, createHashHistory, redirect } from "@tanstack/react-router"
import { ZerobackProvider } from "@zeroback/react"
import { client } from "./lib/zeroback"
import { RootLayout } from "./routes/__root"
import { OverviewPage } from "./routes/index"
import { TablePage } from "./routes/tables/$table"
import { SqlPage } from "./routes/sql/index"

// Route tree
const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
})

const tableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tables/$table",
  component: TablePage,
  validateSearch: (search: Record<string, unknown>) => ({
    doc: (search.doc as string) || undefined,
  }),
})

const sqlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sql",
  component: SqlPage,
})

const routeTree = rootRoute.addChildren([indexRoute, tableRoute, sqlRoute])

// Use hash history so the SPA works when served from /_dashboard
const hashHistory = createHashHistory()

const router = createRouter({
  routeTree,
  history: hashHistory,
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ZerobackProvider client={client}>
      <RouterProvider router={router} />
    </ZerobackProvider>
  </StrictMode>
)
