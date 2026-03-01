import { describe, it, expect } from "vitest"
import { parseCron, nextCronTime } from "./cron-parser"

describe("parseCron", () => {
  it("parses wildcard fields as 'any'", () => {
    const result = parseCron("* * * * *")
    expect(result.minute.type).toBe("any")
    expect(result.hour.type).toBe("any")
    expect(result.dayOfMonth.type).toBe("any")
    expect(result.month.type).toBe("any")
    expect(result.dayOfWeek.type).toBe("any")
  })

  it("parses single values", () => {
    const result = parseCron("30 14 1 6 3")
    expect(result.minute).toEqual({ type: "values", values: new Set([30]) })
    expect(result.hour).toEqual({ type: "values", values: new Set([14]) })
    expect(result.dayOfMonth).toEqual({ type: "values", values: new Set([1]) })
    expect(result.month).toEqual({ type: "values", values: new Set([6]) })
    expect(result.dayOfWeek).toEqual({ type: "values", values: new Set([3]) })
  })

  it("parses ranges (1-5)", () => {
    const result = parseCron("1-5 * * * *")
    expect(result.minute).toEqual({
      type: "values",
      values: new Set([1, 2, 3, 4, 5]),
    })
  })

  it("parses lists (1,3,5)", () => {
    const result = parseCron("0 1,12,23 * * *")
    expect(result.hour).toEqual({
      type: "values",
      values: new Set([1, 12, 23]),
    })
  })

  it("parses step with wildcard (*/15)", () => {
    const result = parseCron("*/15 * * * *")
    expect(result.minute).toEqual({
      type: "values",
      values: new Set([0, 15, 30, 45]),
    })
  })

  it("parses step with range (1-30/5)", () => {
    const result = parseCron("1-30/10 * * * *")
    expect(result.minute).toEqual({
      type: "values",
      values: new Set([1, 11, 21]),
    })
  })

  it("parses step with single start value (5/10)", () => {
    const result = parseCron("5/20 * * * *")
    expect(result.minute).toEqual({
      type: "values",
      values: new Set([5, 25, 45]),
    })
  })

  it("parses complex mixed expression", () => {
    // list + range
    const result = parseCron("0,30 9-17 * 1,6 *")
    expect(result.minute).toEqual({ type: "values", values: new Set([0, 30]) })
    expect(result.hour).toEqual({
      type: "values",
      values: new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]),
    })
    expect(result.month).toEqual({ type: "values", values: new Set([1, 6]) })
  })

  it("throws on wrong number of fields", () => {
    expect(() => parseCron("* * *")).toThrow("expected 5 fields")
    expect(() => parseCron("* * * * * *")).toThrow("expected 5 fields")
  })

  it("trims whitespace", () => {
    const result = parseCron("  0  0  *  *  *  ")
    expect(result.minute).toEqual({ type: "values", values: new Set([0]) })
    expect(result.hour).toEqual({ type: "values", values: new Set([0]) })
  })
})

describe("nextCronTime", () => {
  it("finds next minute for every-minute cron", () => {
    const parsed = parseCron("* * * * *")
    const after = new Date("2024-01-15T10:30:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2024-01-15T10:31:00.000Z")
  })

  it("finds next hour mark", () => {
    const parsed = parseCron("0 * * * *")
    const after = new Date("2024-01-15T10:30:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2024-01-15T11:00:00.000Z")
  })

  it("finds daily at specific time", () => {
    const parsed = parseCron("0 3 * * *")
    const after = new Date("2024-01-15T10:00:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2024-01-16T03:00:00.000Z")
  })

  it("finds daily when time hasn't passed yet", () => {
    const parsed = parseCron("30 14 * * *")
    const after = new Date("2024-01-15T10:00:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2024-01-15T14:30:00.000Z")
  })

  it("finds next matching day of week", () => {
    // Monday = 1
    const parsed = parseCron("0 9 * * 1")
    // Jan 15 2024 is a Monday
    const after = new Date("2024-01-15T10:00:00Z")
    const next = nextCronTime(parsed, after)
    // Next Monday is Jan 22
    expect(next.toISOString()).toBe("2024-01-22T09:00:00.000Z")
  })

  it("finds next matching month", () => {
    const parsed = parseCron("0 0 1 6 *")
    const after = new Date("2024-07-01T00:00:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2025-06-01T00:00:00.000Z")
  })

  it("handles step schedule (every 15 min)", () => {
    const parsed = parseCron("*/15 * * * *")
    const after = new Date("2024-01-15T10:03:00Z")
    const next = nextCronTime(parsed, after)
    expect(next.toISOString()).toBe("2024-01-15T10:15:00.000Z")
  })

  it("advances from the next minute", () => {
    // If "after" is exactly on a matching minute, it should still go to next minute
    const parsed = parseCron("30 10 * * *")
    const after = new Date("2024-01-15T10:30:00Z")
    const next = nextCronTime(parsed, after)
    // Should be next day, not same time
    expect(next.toISOString()).toBe("2024-01-16T10:30:00.000Z")
  })
})
