import { describe, it, expect, vi } from "vitest"
import {
  initialPaginationState,
  resetPagination,
  computeStatus,
  subscribePaginationPages,
  type PaginationCallbacks,
} from "./PaginationCore"
import type { ZerobackClient } from "./ZerobackClient"

function makeCallbacks(): PaginationCallbacks & {
  pages: any[][]
  cursors: (string | null)[]
  isDone: boolean
  numItemsPerPage: number[]
} {
  const state = {
    pages: [] as any[][],
    cursors: [null] as (string | null)[],
    isDone: false,
    numItemsPerPage: [5] as number[],
    setPages: vi.fn((updater: (prev: any[][]) => any[][]) => {
      state.pages = updater(state.pages)
    }),
    setCursors: vi.fn(
      (updater: (prev: (string | null)[]) => (string | null)[]) => {
        state.cursors = updater(state.cursors)
      },
    ),
    setIsDone: vi.fn((value: boolean) => {
      state.isDone = value
    }),
    setNumItemsPerPage: vi.fn((updater: (prev: number[]) => number[]) => {
      state.numItemsPerPage = updater(state.numItemsPerPage)
    }),
  }
  return state
}

describe("PaginationCore", () => {
  // ---------- initialPaginationState ----------
  describe("initialPaginationState()", () => {
    it("returns correct shape with empty pages", () => {
      const state = initialPaginationState(10)
      expect(state.pages).toEqual([])
      expect(state.cursors).toEqual([null])
      expect(state.isDone).toBe(false)
      expect(state.numItemsPerPage).toEqual([10])
    })

    it("stores initialNumItems in numItemsPerPage", () => {
      const state = initialPaginationState(25)
      expect(state.numItemsPerPage).toEqual([25])
    })
  })

  // ---------- resetPagination ----------
  describe("resetPagination()", () => {
    it("calls all 4 callbacks with correct updaters", () => {
      const cbs = makeCallbacks()
      cbs.pages = [["old"]]
      cbs.cursors = [null, "cursor1"]
      cbs.isDone = true
      cbs.numItemsPerPage = [5, 10]

      resetPagination(7, cbs)

      expect(cbs.setPages).toHaveBeenCalledTimes(1)
      expect(cbs.setCursors).toHaveBeenCalledTimes(1)
      expect(cbs.setIsDone).toHaveBeenCalledWith(false)
      expect(cbs.setNumItemsPerPage).toHaveBeenCalledTimes(1)

      expect(cbs.pages).toEqual([])
      expect(cbs.cursors).toEqual([null])
      expect(cbs.isDone).toBe(false)
      expect(cbs.numItemsPerPage).toEqual([7])
    })
  })

  // ---------- computeStatus ----------
  describe("computeStatus()", () => {
    it("returns LoadingFirstPage when pages is empty", () => {
      expect(computeStatus([], false)).toBe("LoadingFirstPage")
    })

    it("returns LoadingFirstPage when pages is empty even if isDone", () => {
      expect(computeStatus([], true)).toBe("LoadingFirstPage")
    })

    it("returns Exhausted when isDone is true with pages", () => {
      expect(computeStatus([["a"]], true)).toBe("Exhausted")
    })

    it("returns CanLoadMore with pages and not done", () => {
      expect(computeStatus([["a"], ["b"]], false)).toBe("CanLoadMore")
    })
  })

  // ---------- subscribePaginationPages ----------
  describe("subscribePaginationPages()", () => {
    function makeMockClient() {
      const subscribers: Array<{
        fnName: string
        args: unknown
        callback: (data: unknown) => void
        unsub: ReturnType<typeof vi.fn>
      }> = []

      const client = {
        subscribe: vi.fn(
          (fnName: string, args: unknown, callback: (data: unknown) => void) => {
            const unsub = vi.fn()
            subscribers.push({ fnName, args, callback, unsub })
            return unsub
          },
        ),
        _subscribers: subscribers,
      }
      return client as unknown as ZerobackClient & { _subscribers: typeof subscribers }
    }

    it("subscribes once per page", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "tasks:list",
        '{"status":"active"}',
        2,
        [null, "cursor1"],
        [5, 5],
        cbs,
      )

      expect(client.subscribe).toHaveBeenCalledTimes(2)
    })

    it("omits cursor for page 0", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "tasks:list",
        '{}',
        1,
        [null],
        [10],
        cbs,
      )

      const callArgs = (client.subscribe as any).mock.calls[0][1]
      expect(callArgs).toEqual({ numItems: 10 })
      expect(callArgs.cursor).toBeUndefined()
    })

    it("includes cursor for page > 0", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        2,
        [null, "abc"],
        [5, 5],
        cbs,
      )

      const page1Args = (client.subscribe as any).mock.calls[1][1]
      expect(page1Args.cursor).toBe("abc")
    })

    it("passes numItems from numItemsPerPage", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        2,
        [null, "c"],
        [10, 20],
        cbs,
      )

      expect((client.subscribe as any).mock.calls[0][1].numItems).toBe(10)
      expect((client.subscribe as any).mock.calls[1][1].numItems).toBe(20)
    })

    it("returns unsubscribe functions", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      const unsubs = subscribePaginationPages(
        client,
        "fn",
        '{}',
        2,
        [null, "c"],
        [5, 5],
        cbs,
      )

      expect(unsubs).toHaveLength(2)
      unsubs[0]()
      expect(client._subscribers[0].unsub).toHaveBeenCalled()
    })

    it("fires page callback on subscription data", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        1,
        [null],
        [5],
        cbs,
      )

      // Simulate server response
      client._subscribers[0].callback({
        page: ["item1", "item2"],
        continueCursor: "next-cursor",
        isDone: false,
      })

      expect(cbs.setPages).toHaveBeenCalled()
      expect(cbs.pages).toEqual([["item1", "item2"]])
    })

    it("fires cursor callback with continueCursor", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        1,
        [null],
        [5],
        cbs,
      )

      client._subscribers[0].callback({
        page: ["a"],
        continueCursor: "next",
        isDone: false,
      })

      expect(cbs.setCursors).toHaveBeenCalled()
      expect(cbs.cursors[1]).toBe("next")
    })

    it("sets isDone when result.isDone is true", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        1,
        [null],
        [5],
        cbs,
      )

      client._subscribers[0].callback({
        page: ["a"],
        continueCursor: null,
        isDone: true,
      })

      expect(cbs.setIsDone).toHaveBeenCalledWith(true)
    })

    it("sets isDone to false when last page is not done", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{}',
        1,
        [null],
        [5],
        cbs,
      )

      client._subscribers[0].callback({
        page: ["a"],
        continueCursor: "next",
        isDone: false,
      })

      // pageIndex === pageCount - 1 and !isDone → setIsDone(false)
      expect(cbs.setIsDone).toHaveBeenCalledWith(false)
    })

    it("subscribes all requested pages even when cursors array is short", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      // Only have cursor for page 0, not for page 1+
      // The `?? null` fallback means cursor is never undefined,
      // so all pages get subscribed with null cursor.
      subscribePaginationPages(
        client,
        "fn",
        '{}',
        3,
        [null], // only 1 cursor entry
        [5, 5, 5],
        cbs,
      )

      expect(client.subscribe).toHaveBeenCalledTimes(3)
    })

    it("merges parsed argsKey into subscription args", () => {
      const client = makeMockClient()
      const cbs = makeCallbacks()

      subscribePaginationPages(
        client,
        "fn",
        '{"status":"active","org":"acme"}',
        1,
        [null],
        [5],
        cbs,
      )

      const args = (client.subscribe as any).mock.calls[0][1]
      expect(args.status).toBe("active")
      expect(args.org).toBe("acme")
      expect(args.numItems).toBe(5)
    })
  })
})
