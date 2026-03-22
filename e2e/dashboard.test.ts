import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { ZerobackTestClient } from "./harness"

describe("dashboard system functions", () => {
  let client: ZerobackTestClient

  beforeAll(async () => {
    client = new ZerobackTestClient()
    await client.connect()
  })

  afterAll(() => {
    client.close()
  })

  beforeEach(async () => {
    await fetch("http://localhost:8788/__dev/reset", { method: "POST" })
  })

  // ── Schema ─────────────────────────────────────────────────────────────

  describe("_system:getSchema", () => {
    it("should return the full schema", async () => {
      const { result: schema } = await client.query("_system:getSchema")
      expect(schema).toHaveProperty("tables")
      expect(schema.tables).toHaveProperty("tasks")
      expect(schema.tables).toHaveProperty("projects")
      expect(schema.tables).toHaveProperty("comments")
      expect(schema.tables.tasks.fields).toHaveProperty("title")
      expect(schema.tables.tasks.fields.title).toEqual({ type: "string" })
    })

    it("should include indexes", async () => {
      const { result: schema } = await client.query("_system:getSchema")
      const taskIndexes = schema.tables.tasks.indexes
      expect(taskIndexes.some((i: any) => i.name === "by_status")).toBe(true)
      expect(taskIndexes.some((i: any) => i.name === "by_project")).toBe(true)
    })
  })

  // ── Table count ────────────────────────────────────────────────────────

  describe("_system:getTableCount", () => {
    it("should return 0 for empty table", async () => {
      const { result: count } = await client.query("_system:getTableCount", { table: "tasks" })
      expect(count).toBe(0)
    })

    it("should return correct count after inserts", async () => {
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "Task 1", status: "open", priority: "high", projectId: "p:1" },
      })
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "Task 2", status: "open", priority: "low", projectId: "p:1" },
      })

      const { result: count } = await client.query("_system:getTableCount", { table: "tasks" })
      expect(count).toBe(2)
    })

    it("should throw for unknown table", async () => {
      const err = await client.queryError("_system:getTableCount", { table: "nonexistent" })
      expect(err.message).toContain("Table not found")
    })
  })

  // ── CRUD ───────────────────────────────────────────────────────────────

  describe("CRUD operations", () => {
    it("should insert, list, get, update, and delete a document", async () => {
      // Insert
      const id = await client.mutation("_system:insertDocument", {
        table: "projects",
        data: { name: "Test Project", description: "A test", color: "#ff0000" },
      })
      expect(id).toMatch(/^projects:/)

      // List
      const { result: list } = await client.query("_system:listDocuments", {
        table: "projects",
        numItems: 10,
      })
      expect(list.page).toHaveLength(1)
      expect(list.page[0]._id).toBe(id)
      expect(list.page[0].name).toBe("Test Project")
      expect(list.isDone).toBe(true)

      // Get
      const { result: doc } = await client.query("_system:getDocument", { id })
      expect(doc.name).toBe("Test Project")
      expect(doc._id).toBe(id)

      // Update
      await client.mutation("_system:updateDocument", {
        id,
        fields: { name: "Updated Project" },
      })
      const { result: updated } = await client.query("_system:getDocument", { id })
      expect(updated.name).toBe("Updated Project")

      // Delete
      await client.mutation("_system:deleteDocument", { id })
      const { result: deleted } = await client.query("_system:getDocument", { id })
      expect(deleted).toBeNull()
    })

    it("should paginate documents", async () => {
      // Insert 5 documents
      for (let i = 0; i < 5; i++) {
        await client.mutation("_system:insertDocument", {
          table: "tasks",
          data: { title: `Task ${i}`, status: "open", priority: "medium", projectId: "p:1" },
        })
      }

      // First page (2 items)
      const { result: page1 } = await client.query("_system:listDocuments", {
        table: "tasks",
        numItems: 2,
      })
      expect(page1.page).toHaveLength(2)
      expect(page1.isDone).toBe(false)
      expect(page1.continueCursor).toBeTruthy()

      // Second page
      const { result: page2 } = await client.query("_system:listDocuments", {
        table: "tasks",
        numItems: 2,
        cursor: page1.continueCursor,
      })
      expect(page2.page).toHaveLength(2)
      expect(page2.isDone).toBe(false)

      // Third page (1 remaining)
      const { result: page3 } = await client.query("_system:listDocuments", {
        table: "tasks",
        numItems: 2,
        cursor: page2.continueCursor,
      })
      expect(page3.page).toHaveLength(1)
      expect(page3.isDone).toBe(true)
    })

    it("should sort documents", async () => {
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "Alpha", status: "open", priority: "high", projectId: "p:1" },
      })
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "Zeta", status: "open", priority: "low", projectId: "p:1" },
      })

      const { result: asc } = await client.query("_system:listDocuments", {
        table: "tasks",
        sort: { field: "title", direction: "asc" },
      })
      expect(asc.page[0].title).toBe("Alpha")
      expect(asc.page[1].title).toBe("Zeta")

      const { result: desc } = await client.query("_system:listDocuments", {
        table: "tasks",
        sort: { field: "title", direction: "desc" },
      })
      expect(desc.page[0].title).toBe("Zeta")
      expect(desc.page[1].title).toBe("Alpha")
    })
  })

  // ── SQL Console ────────────────────────────────────────────────────────

  describe("_system:runSQL", () => {
    it("should execute SELECT queries", async () => {
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "SQL Test", status: "open", priority: "high", projectId: "p:1" },
      })

      const result = await client.action("_system:runSQL", {
        query: "SELECT title, status FROM tasks",
      })
      expect(result.columns).toContain("title")
      expect(result.columns).toContain("status")
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].title).toBe("SQL Test")
    })

    it("should reject non-SELECT queries", async () => {
      const err = await client.actionError("_system:runSQL", {
        query: "DELETE FROM tasks",
      })
      expect(err.message).toContain("Only SELECT queries are allowed")
    })

    it("should reject multiple statements", async () => {
      const err = await client.actionError("_system:runSQL", {
        query: "SELECT 1; DROP TABLE tasks",
      })
      expect(err.message).toContain("Multiple statements are not allowed")
    })
  })

  // ── Dashboard endpoint ─────────────────────────────────────────────────

  describe("dashboard endpoint", () => {
    it("should serve the dashboard HTML at /_dashboard", async () => {
      const res = await fetch("http://localhost:8788/_dashboard")
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
      const html = await res.text()
      expect(html).toContain("<!DOCTYPE html>")
      expect(html).toContain("Zeroback")
    })

    it("should serve dashboard for sub-paths too", async () => {
      const res = await fetch("http://localhost:8788/_dashboard/tables/tasks")
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
    })
  })

  // ── Real-time subscriptions ────────────────────────────────────────────

  describe("real-time updates", () => {
    it("should receive subscription update when document is inserted", async () => {
      // Subscribe to listDocuments
      const { id: subId } = await client.query("_system:listDocuments", {
        table: "tasks",
        numItems: 10,
      })

      // Set up update listener
      const updatePromise = client.waitForUpdate(subId)

      // Insert a document
      await client.mutation("_system:insertDocument", {
        table: "tasks",
        data: { title: "Real-time test", status: "open", priority: "high", projectId: "p:1" },
      })

      // Should receive an update with the new document
      const updated = await updatePromise
      expect(updated.page).toHaveLength(1)
      expect(updated.page[0].title).toBe("Real-time test")

      client.unsubscribe(subId)
    })
  })
})
