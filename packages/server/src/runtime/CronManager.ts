import { typeid } from "typeid-js";
import type { CronSchedule, CronJobDef } from "@zeroback/server";
import { getNextRunTime } from "@zeroback/server";
import type { SqlApi } from "./types";

export class CronManager {
  constructor(
    private sql: SqlApi,
    private ctx: { storage: { setAlarm(time: number): void } },
  ) {}

  /** Sync cron job definitions from code into SQLite and set the next alarm. */
  initializeCronJobs(cronJobsDef: { jobs: CronJobDef[] } | null): void {
    if (!cronJobsDef || !cronJobsDef.jobs || cronJobsDef.jobs.length === 0) return;

    const now = Date.now();
    const definedNames = new Set<string>();

    for (const job of cronJobsDef.jobs) {
      definedNames.add(job.name);

      const existing = this.sql.exec(
        `SELECT name, schedule FROM cron_jobs WHERE name = ?`, job.name
      ).toArray() as { name: string; schedule: string }[];

      const scheduleJSON = JSON.stringify(job.schedule);

      if (existing.length === 0) {
        const nextRun = getNextRunTime(job.schedule, now);
        this.sql.exec(
          `INSERT INTO cron_jobs (name, fn_name, args, schedule, next_run_at) VALUES (?, ?, ?, ?, ?)`,
          job.name, job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun
        );
      } else if (existing[0].schedule !== scheduleJSON) {
        const nextRun = getNextRunTime(job.schedule, now);
        this.sql.exec(
          `UPDATE cron_jobs SET fn_name = ?, args = ?, schedule = ?, next_run_at = ? WHERE name = ?`,
          job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun, job.name
        );
      }
    }

    // Remove crons no longer defined in code
    const allCrons = this.sql.exec(`SELECT name FROM cron_jobs`).toArray() as { name: string }[];
    for (const row of allCrons) {
      if (!definedNames.has(row.name)) {
        this.sql.exec(`DELETE FROM cron_jobs WHERE name = ?`, row.name);
      }
    }

    this.ensureNextAlarm();
  }

  /** Set the DO alarm to the earliest pending scheduled job or cron job. */
  ensureNextAlarm(): void {
    const scheduledNext = this.sql.exec(
      `SELECT MIN(run_at) as next FROM scheduled_jobs WHERE status = 'pending'`
    ).toArray() as { next: number | null }[];

    const cronNext = this.sql.exec(
      `SELECT MIN(next_run_at) as next FROM cron_jobs`
    ).toArray() as { next: number | null }[];

    const times: number[] = [];
    if (scheduledNext[0]?.next != null) times.push(scheduledNext[0].next);
    if (cronNext[0]?.next != null) times.push(cronNext[0].next);

    if (times.length > 0) {
      this.ctx.storage.setAlarm(Math.min(...times));
    }
  }

  createScheduler() {
    return {
      runAfter: async (delayMs: number, fnName: string, args?: unknown): Promise<string> => {
        const runAt = Date.now() + delayMs;
        return this.scheduleJob(runAt, fnName, args ?? {});
      },
      runAt: async (timestamp: number, fnName: string, args?: unknown): Promise<string> => {
        return this.scheduleJob(timestamp, fnName, args ?? {});
      },
      cancel: async (id: string): Promise<void> => {
        this.sql.exec(
          `DELETE FROM scheduled_jobs WHERE id = ? AND status = 'pending'`,
          id
        );
      },
    };
  }

  private async scheduleJob(runAt: number, fnName: string, args: unknown): Promise<string> {
    const id = typeid("job").toString();
    this.sql.exec(
      `INSERT INTO scheduled_jobs (id, run_at, fn_name, args, status) VALUES (?, ?, ?, ?, 'pending')`,
      id, runAt, fnName, JSON.stringify(args)
    );

    this.ensureNextAlarm();
    return id;
  }

  /** Process due scheduled jobs and cron jobs. Returns after all are handled. */
  async processAlarm(
    executeFunction: (fnName: string, args: unknown) => Promise<void>
  ): Promise<void> {
    const now = Date.now();

    // 1. Process due scheduled jobs
    const dueJobs = this.sql.exec(
      `SELECT id, fn_name, args FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at`,
      now
    ).toArray() as { id: string; fn_name: string; args: string }[];

    for (const job of dueJobs) {
      this.sql.exec(`UPDATE scheduled_jobs SET status = 'running' WHERE id = ?`, job.id);
      try {
        await executeFunction(job.fn_name, JSON.parse(job.args));
        this.sql.exec(`UPDATE scheduled_jobs SET status = 'completed' WHERE id = ?`, job.id);
      } catch (e) {
        console.error(`Scheduled job ${job.id} (${job.fn_name}) failed:`, e);
        this.sql.exec(`UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?`, job.id);
      }
    }

    // Clean up completed/failed scheduled jobs
    this.sql.exec(`DELETE FROM scheduled_jobs WHERE status IN ('completed', 'failed')`);

    // 2. Process due cron jobs
    const dueCrons = this.sql.exec(
      `SELECT name, fn_name, args, schedule FROM cron_jobs WHERE next_run_at <= ?`,
      now
    ).toArray() as { name: string; fn_name: string; args: string; schedule: string }[];

    for (const cron of dueCrons) {
      try {
        await executeFunction(cron.fn_name, JSON.parse(cron.args));
      } catch (e) {
        console.error(`Cron job "${cron.name}" (${cron.fn_name}) failed:`, e);
      }

      // Compute next run time regardless of success/failure
      const schedule = JSON.parse(cron.schedule) as CronSchedule;
      const nextRun = getNextRunTime(schedule, now);
      this.sql.exec(
        `UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE name = ?`,
        now, nextRun, cron.name
      );
    }

    // 3. Set the next alarm
    this.ensureNextAlarm();
  }
}
