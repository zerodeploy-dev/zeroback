import { describe, it, expect, beforeAll } from "vitest"
import { ZerobackTestClient } from "./harness"
import WS from "ws"
// Polyfill WebSocket for Node so ZerobackTestClient works in tests
;(globalThis as any).WebSocket = WS

const BASE = "http://localhost:8788"

// Unique email per test run to avoid conflicts with persistent auth state
const TEST_EMAIL = `test-${Date.now()}@example.com`
const TEST_PASSWORD = "password123"
const TEST_NAME = "Test User"

describe("auth", () => {
  // ---------------------------------------------------------------------------
  // Sign up
  // ---------------------------------------------------------------------------
  describe("POST /auth/sign-up/email", () => {
    it("creates a new user and sets a session cookie", async () => {
      const res = await fetch(`${BASE}/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
      })

      expect(res.status).toBe(200)

      const setCookie = res.headers.get("set-cookie")
      expect(setCookie).toBeTruthy()
      // better-auth session cookie is named "better-auth.session_token"
      expect(setCookie).toContain("better-auth.session_token")
    })

    it("rejects sign-up with a duplicate email", async () => {
      // First sign-up (may already exist from the previous test, that's fine)
      await fetch(`${BASE}/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
      })

      // Second sign-up with the same email should fail
      const res = await fetch(`${BASE}/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
      })

      // better-auth returns 422 for duplicate email
      expect(res.status).not.toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------
  describe("POST /auth/sign-in/email", () => {
    it("returns 200 and a session cookie for valid credentials", async () => {
      // Ensure user exists first
      await fetch(`${BASE}/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
      })

      const res = await fetch(`${BASE}/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      })

      expect(res.status).toBe(200)

      const setCookie = res.headers.get("set-cookie")
      expect(setCookie).toBeTruthy()
      expect(setCookie).toContain("better-auth.session_token")
    })

    it("rejects sign-in with wrong password", async () => {
      const res = await fetch(`${BASE}/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: "wrong-password" }),
      })

      expect(res.status).not.toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Get session
  // ---------------------------------------------------------------------------
  describe("GET /auth/get-session", () => {
    let sessionCookie: string

    beforeAll(async () => {
      // Sign up (idempotent — may already exist)
      await fetch(`${BASE}/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
      })

      // Sign in to get a fresh cookie
      const signInRes = await fetch(`${BASE}/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      })

      sessionCookie = signInRes.headers.get("set-cookie") ?? ""
    })

    it("returns session user identity when cookie is present", async () => {
      const res = await fetch(`${BASE}/auth/get-session`, {
        headers: { Cookie: sessionCookie },
      })

      expect(res.status).toBe(200)

      const body = await res.json() as { user?: { email?: string; name?: string } }
      expect(body.user).toBeDefined()
      expect(body.user?.email).toBe(TEST_EMAIL)
      expect(body.user?.name).toBe(TEST_NAME)
    })

    it("returns null session without a cookie", async () => {
      const res = await fetch(`${BASE}/auth/get-session`)

      // better-auth returns 200 with null body or 401 for unauthenticated
      const text = await res.text()
      if (res.status === 200 && text) {
        const body = JSON.parse(text)
        expect(body).toBeNull()
      } else {
        // 401 is also acceptable for no session
        expect([200, 401, 204]).toContain(res.status)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Auth tables don't appear in schema queries
  // ---------------------------------------------------------------------------
  describe("schema isolation", () => {
    it("does not expose _auth_* tables in _system:getSchema", async () => {
      const res = await fetch(`${BASE}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fn: "_system:getSchema", args: {} }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { result: { tables: Record<string, unknown> } }
      const tableNames = Object.keys(body.result?.tables ?? {})

      // No table name should start with the auth prefix
      for (const name of tableNames) {
        expect(name).not.toMatch(/^_auth_/)
        // better-auth internal table names used by DOSQLiteAdapter
        expect(name).not.toMatch(/^(user|account|session|verification)$/)
      }

      // User-defined tables should still be present
      expect(tableNames).toContain("tasks")
      expect(tableNames).toContain("projects")
    })
  })

  // ---------------------------------------------------------------------------
  // Non-existent auth routes
  // ---------------------------------------------------------------------------
  describe("unknown auth routes", () => {
    it("returns a non-200 response for /auth/nonexistent-route", async () => {
      const res = await fetch(`${BASE}/auth/nonexistent-route`)

      // better-auth returns 404 for unrecognized paths within /auth/
      expect(res.status).not.toBe(200)
    })
  })

  // ---------------------------------------------------------------------------
  // Unauthenticated WebSocket connection
  // ---------------------------------------------------------------------------
  describe("WebSocket without auth cookie", () => {
    it("connects successfully and can run queries without a session", async () => {
      const client = new ZerobackTestClient()
      try {
        await client.connect()

        // A basic query should work — auth is optional, not enforced by default
        const { result } = await client.query("tasks:recent", { limit: 1 })
        expect(Array.isArray(result)).toBe(true)
      } finally {
        client.close()
      }
    })
  })
})
