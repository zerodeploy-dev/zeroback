import { parseCron, nextCronTime } from "./cron-parser.js";
import type { ParsedCron } from "./cron-parser.js";

export type CronSchedule =
  | { type: "interval"; ms: number }
  | { type: "cron"; expression: string; parsed: ParsedCron };

export type CronJobDef = {
  name: string;
  schedule: CronSchedule;
  fnName: string;
  args: unknown;
};

export class CronJobs {
  readonly jobs: CronJobDef[] = [];

  /**
   * Run a function at a fixed interval.
   *
   *   crons.interval("cleanup", { hours: 1 }, "messages:cleanup");
   *   crons.interval("ping", { minutes: 5, seconds: 30 }, "system:ping");
   */
  interval(
    name: string,
    schedule: { hours?: number; minutes?: number; seconds?: number },
    fnName: string,
    args: unknown = {}
  ): void {
    const ms =
      (schedule.hours ?? 0) * 3_600_000 +
      (schedule.minutes ?? 0) * 60_000 +
      (schedule.seconds ?? 0) * 1_000;
    if (ms <= 0) throw new Error(`Cron "${name}": interval must be positive`);
    this.jobs.push({ name, schedule: { type: "interval", ms }, fnName, args });
  }

  /**
   * Run a function on a cron schedule (UTC).
   *
   *   crons.cron("nightly", "0 3 * * *", "jobs:nightly");
   */
  cron(name: string, expression: string, fnName: string, args: unknown = {}): void {
    const parsed = parseCron(expression);
    this.jobs.push({ name, schedule: { type: "cron", expression, parsed }, fnName, args });
  }

  /**
   * Run a function once per hour.
   *
   *   crons.hourly("stats", { minuteUTC: 15 }, "analytics:aggregate");
   */
  hourly(name: string, opts: { minuteUTC?: number } = {}, fnName: string, args: unknown = {}): void {
    const minute = opts.minuteUTC ?? 0;
    this.cron(name, `${minute} * * * *`, fnName, args);
  }

  /**
   * Run a function once per day.
   *
   *   crons.daily("digest", { hourUTC: 9, minuteUTC: 0 }, "email:sendDigest");
   */
  daily(name: string, opts: { hourUTC?: number; minuteUTC?: number } = {}, fnName: string, args: unknown = {}): void {
    const hour = opts.hourUTC ?? 0;
    const minute = opts.minuteUTC ?? 0;
    this.cron(name, `${minute} ${hour} * * *`, fnName, args);
  }

  /**
   * Run a function once per week.
   *
   *   crons.weekly("report", { dayOfWeek: 1, hourUTC: 8 }, "reports:weekly");
   *   // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
   */
  weekly(
    name: string,
    opts: { dayOfWeek?: number; hourUTC?: number; minuteUTC?: number } = {},
    fnName: string,
    args: unknown = {}
  ): void {
    const dow = opts.dayOfWeek ?? 1; // Monday
    const hour = opts.hourUTC ?? 0;
    const minute = opts.minuteUTC ?? 0;
    this.cron(name, `${minute} ${hour} * * ${dow}`, fnName, args);
  }

  /**
   * Run a function once per month.
   *
   *   crons.monthly("billing", { dayOfMonth: 1, hourUTC: 0 }, "billing:charge");
   */
  monthly(
    name: string,
    opts: { dayOfMonth?: number; hourUTC?: number; minuteUTC?: number } = {},
    fnName: string,
    args: unknown = {}
  ): void {
    const dom = opts.dayOfMonth ?? 1;
    const hour = opts.hourUTC ?? 0;
    const minute = opts.minuteUTC ?? 0;
    this.cron(name, `${minute} ${hour} ${dom} * *`, fnName, args);
  }
}

export function cronJobs(): CronJobs {
  return new CronJobs();
}

/**
 * Compute the next run time for a cron schedule.
 */
export function getNextRunTime(schedule: CronSchedule, lastRun: number): number {
  if (schedule.type === "interval") {
    return lastRun + schedule.ms;
  }
  return nextCronTime(schedule.parsed, new Date(lastRun)).getTime();
}
