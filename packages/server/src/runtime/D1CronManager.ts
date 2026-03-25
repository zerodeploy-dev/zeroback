import { ulid } from "ulidx"
import type { CronSchedule, CronJobDef } from "@zeroback/server"
import { getNextRunTime } from "@zeroback/server"
import type { AsyncSqlApi } from "./types"

/**
 * Cron manager for D1 mode.
 * Uses Cloudflare Workers Cron Triggers (scheduled() handler) instead of DO alarms.
 * Minimum granularity is ~1 minute.
 */
export class D1CronManager {
  constructor(private sql: AsyncSqlApi) {}

  /** Sync cron job definitions from code into D1 and return a scheduler. */
  async initializeCronJobs(cronJobsDef: { jobs: CronJobDef[] } | null): Promise<void> {
    if (!cronJobsDef || !cronJobsDef.jobs || cronJobsDef.jobs.length === 0) return

    const now = Date.now()
    const definedNames = new Set<string>()

    for (const job of cronJobsDef.jobs) {
      definedNames.add(job.name)

      const existing = (await this.sql.exec(
        `SELECT name, schedule FROM cron_jobs WHERE name = ?`, job.name
      )).toArray() as { name: string; schedule: string }[]

      const scheduleJSON = JSON.stringify(job.schedule)

      if (existing.length === 0) {
        const nextRun = getNextRunTime(job.schedule, now)
        await this.sql.exec(
          `INSERT INTO cron_jobs (name, fn_name, args, schedule, next_run_at) VALUES (?, ?, ?, ?, ?)`,
          job.name, job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun
        )
      } else if (existing[0].schedule !== scheduleJSON) {
        const nextRun = getNextRunTime(job.schedule, now)
        await this.sql.exec(
          `UPDATE cron_jobs SET fn_name = ?, args = ?, schedule = ?, next_run_at = ? WHERE name = ?`,
          job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun, job.name
        )
      }
    }

    // Remove crons no longer defined in code
    const allCrons = (await this.sql.exec(`SELECT name FROM cron_jobs`)).toArray() as { name: string }[]
    for (const row of allCrons) {
      if (!definedNames.has(row.name)) {
        await this.sql.exec(`DELETE FROM cron_jobs WHERE name = ?`, row.name)
      }
    }
  }

  createScheduler() {
    return {
      runAfter: async (delayMs: number, fnName: string, args?: unknown): Promise<string> => {
        const runAt = Date.now() + delayMs
        return this.scheduleJob(runAt, fnName, args ?? {})
      },
      runAt: async (timestamp: number, fnName: string, args?: unknown): Promise<string> => {
        return this.scheduleJob(timestamp, fnName, args ?? {})
      },
      cancel: async (id: string): Promise<void> => {
        await this.sql.exec(
          `DELETE FROM scheduled_jobs WHERE id = ? AND status = 'pending'`,
          id
        )
      },
    }
  }

  private async scheduleJob(runAt: number, fnName: string, args: unknown): Promise<string> {
    const id = ulid()
    await this.sql.exec(
      `INSERT INTO scheduled_jobs (id, run_at, fn_name, args, status) VALUES (?, ?, ?, ?, 'pending')`,
      id, runAt, fnName, JSON.stringify(args)
    )
    return id
  }

  /** Process due scheduled jobs and cron jobs. Called from the Workers scheduled() handler. */
  async processScheduled(
    executeFunction: (fnName: string, args: unknown) => Promise<void>
  ): Promise<void> {
    const now = Date.now()

    // 1. Process due scheduled jobs
    const dueJobs = (await this.sql.exec(
      `SELECT id, fn_name, args FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at`,
      now
    )).toArray() as { id: string; fn_name: string; args: string }[]

    for (const job of dueJobs) {
      await this.sql.exec(`UPDATE scheduled_jobs SET status = 'running' WHERE id = ?`, job.id)
      try {
        await executeFunction(job.fn_name, JSON.parse(job.args))
        await this.sql.exec(`UPDATE scheduled_jobs SET status = 'completed' WHERE id = ?`, job.id)
      } catch (e) {
        console.error(`Scheduled job ${job.id} (${job.fn_name}) failed:`, e)
        await this.sql.exec(`UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?`, job.id)
      }
    }

    // Clean up completed/failed scheduled jobs
    await this.sql.exec(`DELETE FROM scheduled_jobs WHERE status IN ('completed', 'failed')`)

    // 2. Process due cron jobs
    const dueCrons = (await this.sql.exec(
      `SELECT name, fn_name, args, schedule FROM cron_jobs WHERE next_run_at <= ?`,
      now
    )).toArray() as { name: string; fn_name: string; args: string; schedule: string }[]

    for (const cron of dueCrons) {
      try {
        await executeFunction(cron.fn_name, JSON.parse(cron.args))
      } catch (e) {
        console.error(`Cron job "${cron.name}" (${cron.fn_name}) failed:`, e)
      }

      const schedule = JSON.parse(cron.schedule) as CronSchedule
      const nextRun = getNextRunTime(schedule, now)
      await this.sql.exec(
        `UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE name = ?`,
        now, nextRun, cron.name
      )
    }
  }
}
