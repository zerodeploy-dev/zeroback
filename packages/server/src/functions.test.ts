import { describe, it, expect, vi } from "vitest"
import { v } from "@zeroback/values"
import {
  createQueryFactory,
  createMutationFactory,
  createActionFactory,
  createInternalQueryFactory,
  createInternalMutationFactory,
  createInternalActionFactory,
} from "./functions"

describe("function factories", () => {
  describe("createQueryFactory", () => {
    it("creates a registered query with correct metadata", () => {
      const query = createQueryFactory()
      const fn = query({
        args: { id: v.string() },
        handler: async (ctx, args) => ({ found: true }),
      })

      expect(fn._type).toBe("query")
      expect(fn._isInternal).toBe(false)
      expect(fn._argsValidator).toEqual({ id: v.string() })
      expect(fn.handler).toBeTypeOf("function")
    })

    it("stores returns validator when provided", () => {
      const query = createQueryFactory()
      const fn = query({
        args: { id: v.string() },
        returns: v.string(),
        handler: async () => "result",
      })

      expect(fn._returnsValidator).toBeDefined()
    })

    it("leaves _returnsValidator undefined when not provided", () => {
      const query = createQueryFactory()
      const fn = query({
        args: {},
        handler: async () => null,
      })

      expect(fn._returnsValidator).toBeUndefined()
    })

    it("handler is callable", async () => {
      const query = createQueryFactory()
      const fn = query({
        args: { x: v.number() },
        handler: async (_ctx, args) => args.x * 2,
      })

      const result = await fn.handler({} as any, { x: 5 })
      expect(result).toBe(10)
    })
  })

  describe("createMutationFactory", () => {
    it("creates a registered mutation", () => {
      const mutation = createMutationFactory()
      const fn = mutation({
        args: { title: v.string() },
        handler: async (ctx, args) => "id-1",
      })

      expect(fn._type).toBe("mutation")
      expect(fn._isInternal).toBe(false)
    })
  })

  describe("createActionFactory", () => {
    it("creates a registered action", () => {
      const action = createActionFactory()
      const fn = action({
        args: { url: v.string() },
        handler: async (ctx, args) => null,
      })

      expect(fn._type).toBe("action")
      expect(fn._isInternal).toBe(false)
    })
  })

  describe("internal variants", () => {
    it("createInternalQueryFactory sets _isInternal to true", () => {
      const query = createInternalQueryFactory()
      const fn = query({ args: {}, handler: async () => null })
      expect(fn._type).toBe("query")
      expect(fn._isInternal).toBe(true)
    })

    it("createInternalMutationFactory sets _isInternal to true", () => {
      const mutation = createInternalMutationFactory()
      const fn = mutation({ args: {}, handler: async () => null })
      expect(fn._type).toBe("mutation")
      expect(fn._isInternal).toBe(true)
    })

    it("createInternalActionFactory sets _isInternal to true", () => {
      const action = createInternalActionFactory()
      const fn = action({ args: {}, handler: async () => null })
      expect(fn._type).toBe("action")
      expect(fn._isInternal).toBe(true)
    })
  })
})
