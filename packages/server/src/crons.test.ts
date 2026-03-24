import { describe, it, expect } from "vitest"
import { CronJobs, cronJobs, getNextRunTime } from "./crons"
import type { CronSchedule } from "./crons"

describe("CronJobs", () => {
  describe("cronJobs() factory", () => {
    it("returns a new CronJobs instance", () => {
      const cj = cronJobs()
      expect(cj).toBeInstanceOf(CronJobs)
      expect(cj.jobs).toEqual([])
    })
  })

  describe("interval()", () => {
    it("adds interval job with hours", () => {
      const cj = cronJobs()
      cj.interval("cleanup", { hours: 2 }, "tasks:cleanup")
      expect(cj.jobs).toHaveLength(1)
      expect(cj.jobs[0].name).toBe("cleanup")
      expect(cj.jobs[0].fnName).toBe("tasks:cleanup")
      expect(cj.jobs[0].schedule).toEqual({ type: "interval", ms: 7_200_000 })
    })

    it("adds interval job with mixed units", () => {
      const cj = cronJobs()
      cj.interval("ping", { minutes: 5, seconds: 30 }, "system:ping")
      expect(cj.jobs[0].schedule).toEqual({ type: "interval", ms: 330_000 })
    })

    it("throws on zero interval", () => {
      const cj = cronJobs()
      expect(() => cj.interval("bad", {}, "fn")).toThrow("interval must be positive")
    })

    it("stores args (defaults to empty object)", () => {
      const cj = cronJobs()
      cj.interval("j1", { seconds: 1 }, "fn")
      expect(cj.jobs[0].args).toEqual({})

      cj.interval("j2", { seconds: 1 }, "fn", { key: "val" })
      expect(cj.jobs[1].args).toEqual({ key: "val" })
    })
  })

  describe("cron()", () => {
    it("adds cron job with parsed expression", () => {
      const cj = cronJobs()
      cj.cron("nightly", "0 3 * * *", "jobs:nightly")
      expect(cj.jobs).toHaveLength(1)
      expect(cj.jobs[0].name).toBe("nightly")
      expect(cj.jobs[0].schedule.type).toBe("cron")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 3 * * *")
      expect(schedule.parsed.minute).toEqual({ type: "values", values: new Set([0]) })
    })

    it("throws on invalid cron expression", () => {
      const cj = cronJobs()
      expect(() => cj.cron("bad", "not valid", "fn")).toThrow()
    })
  })

  describe("hourly()", () => {
    it("defaults to minute 0", () => {
      const cj = cronJobs()
      cj.hourly("stats", {}, "analytics:aggregate")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 * * * *")
    })

    it("uses specified minuteUTC", () => {
      const cj = cronJobs()
      cj.hourly("stats", { minuteUTC: 15 }, "analytics:aggregate")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("15 * * * *")
    })
  })

  describe("daily()", () => {
    it("defaults to midnight UTC", () => {
      const cj = cronJobs()
      cj.daily("digest", {}, "email:sendDigest")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 0 * * *")
    })

    it("uses specified hour and minute", () => {
      const cj = cronJobs()
      cj.daily("digest", { hourUTC: 9, minuteUTC: 30 }, "email:sendDigest")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("30 9 * * *")
    })
  })

  describe("weekly()", () => {
    it("defaults to Monday midnight UTC", () => {
      const cj = cronJobs()
      cj.weekly("report", {}, "reports:weekly")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 0 * * 1")
    })

    it("uses specified day, hour, minute", () => {
      const cj = cronJobs()
      cj.weekly("report", { dayOfWeek: 5, hourUTC: 17, minuteUTC: 0 }, "reports:weekly")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 17 * * 5")
    })
  })

  describe("monthly()", () => {
    it("defaults to 1st at midnight UTC", () => {
      const cj = cronJobs()
      cj.monthly("billing", {}, "billing:charge")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 0 1 * *")
    })

    it("uses specified day, hour, minute", () => {
      const cj = cronJobs()
      cj.monthly("billing", { dayOfMonth: 15, hourUTC: 6 }, "billing:charge")
      const schedule = cj.jobs[0].schedule as Extract<CronSchedule, { type: "cron" }>
      expect(schedule.expression).toBe("0 6 15 * *")
    })
  })
})

describe("getNextRunTime", () => {
  it("returns lastRun + ms for interval schedule", () => {
    const schedule: CronSchedule = { type: "interval", ms: 60_000 }
    const lastRun = 1700000000000
    expect(getNextRunTime(schedule, lastRun)).toBe(1700000060000)
  })

  it("returns next cron time for cron schedule", () => {
    const cj = cronJobs()
    cj.cron("test", "0 3 * * *", "fn")
    const schedule = cj.jobs[0].schedule

    const lastRun = new Date("2024-01-15T03:00:00Z").getTime()
    const next = getNextRunTime(schedule, lastRun)
    expect(new Date(next).toISOString()).toBe("2024-01-16T03:00:00.000Z")
  })
})
