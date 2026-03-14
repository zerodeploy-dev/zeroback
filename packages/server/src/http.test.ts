import { describe, it, expect, vi } from "vitest"
import { HttpRouter, httpRouter, httpAction } from "./http"

describe("httpAction()", () => {
  it("wraps a handler with _type httpAction", () => {
    const handler = vi.fn()
    const action = httpAction(handler)
    expect(action._type).toBe("httpAction")
    expect(action.handler).toBe(handler)
  })
})

describe("httpRouter()", () => {
  it("returns a new HttpRouter instance", () => {
    const router = httpRouter()
    expect(router).toBeInstanceOf(HttpRouter)
    expect(router.routes).toEqual([])
  })
})

describe("HttpRouter", () => {
  describe("route()", () => {
    it("adds an exact path route", () => {
      const router = httpRouter()
      const handler = vi.fn()
      router.route({
        path: "/api/users",
        method: "GET",
        handler: httpAction(handler),
      })
      expect(router.routes).toHaveLength(1)
      expect(router.routes[0].path).toBe("/api/users")
      expect(router.routes[0].method).toBe("GET")
    })

    it("uppercases the method", () => {
      const router = httpRouter()
      router.route({
        path: "/api/data",
        method: "post",
        handler: httpAction(vi.fn()),
      })
      expect(router.routes[0].method).toBe("POST")
    })
  })

  describe("routeWithPrefix()", () => {
    it("adds a prefix route", () => {
      const router = httpRouter()
      const handler = vi.fn()
      router.routeWithPrefix({
        pathPrefix: "/api/",
        method: "GET",
        handler: httpAction(handler),
      })
      expect(router.routes).toHaveLength(1)
      expect(router.routes[0].pathPrefix).toBe("/api/")
      expect(router.routes[0].method).toBe("GET")
    })
  })

  describe("lookup()", () => {
    it("finds exact match", () => {
      const router = httpRouter()
      const handler = vi.fn()
      router.route({
        path: "/api/users",
        method: "GET",
        handler: httpAction(handler),
      })

      const found = router.lookup("GET", "/api/users")
      expect(found).toBe(handler)
    })

    it("returns null for no match", () => {
      const router = httpRouter()
      expect(router.lookup("GET", "/nowhere")).toBeNull()
    })

    it("matches method case-insensitively", () => {
      const router = httpRouter()
      const handler = vi.fn()
      router.route({
        path: "/api/data",
        method: "POST",
        handler: httpAction(handler),
      })

      expect(router.lookup("post", "/api/data")).toBe(handler)
      expect(router.lookup("Post", "/api/data")).toBe(handler)
    })

    it("does not match wrong method", () => {
      const router = httpRouter()
      router.route({
        path: "/api/data",
        method: "GET",
        handler: httpAction(vi.fn()),
      })

      expect(router.lookup("POST", "/api/data")).toBeNull()
    })

    it("does not match wrong path for exact route", () => {
      const router = httpRouter()
      router.route({
        path: "/api/users",
        method: "GET",
        handler: httpAction(vi.fn()),
      })

      expect(router.lookup("GET", "/api/users/123")).toBeNull()
    })

    it("matches prefix route", () => {
      const router = httpRouter()
      const handler = vi.fn()
      router.routeWithPrefix({
        pathPrefix: "/api/",
        method: "GET",
        handler: httpAction(handler),
      })

      expect(router.lookup("GET", "/api/users")).toBe(handler)
      expect(router.lookup("GET", "/api/users/123")).toBe(handler)
      expect(router.lookup("GET", "/api/")).toBe(handler)
    })

    it("does not match prefix when path doesn't start with prefix", () => {
      const router = httpRouter()
      router.routeWithPrefix({
        pathPrefix: "/api/",
        method: "GET",
        handler: httpAction(vi.fn()),
      })

      expect(router.lookup("GET", "/other/path")).toBeNull()
    })

    it("prefers exact match over prefix match", () => {
      const router = httpRouter()
      const exactHandler = vi.fn()
      const prefixHandler = vi.fn()

      router.routeWithPrefix({
        pathPrefix: "/api/",
        method: "GET",
        handler: httpAction(prefixHandler),
      })
      router.route({
        path: "/api/users",
        method: "GET",
        handler: httpAction(exactHandler),
      })

      expect(router.lookup("GET", "/api/users")).toBe(exactHandler)
      expect(router.lookup("GET", "/api/other")).toBe(prefixHandler)
    })

    it("handles multiple routes for different methods on same path", () => {
      const router = httpRouter()
      const getHandler = vi.fn()
      const postHandler = vi.fn()

      router.route({ path: "/api/data", method: "GET", handler: httpAction(getHandler) })
      router.route({ path: "/api/data", method: "POST", handler: httpAction(postHandler) })

      expect(router.lookup("GET", "/api/data")).toBe(getHandler)
      expect(router.lookup("POST", "/api/data")).toBe(postHandler)
    })
  })
})
