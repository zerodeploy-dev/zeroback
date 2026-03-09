import type { CronJobDef } from "@zeroback/server";
import type { SqlApi } from "./types";
export declare class CronManager {
    private sql;
    private ctx;
    constructor(sql: SqlApi, ctx: {
        storage: {
            setAlarm(time: number): void;
        };
    });
    /** Sync cron job definitions from code into SQLite and set the next alarm. */
    initializeCronJobs(cronJobsDef: {
        jobs: CronJobDef[];
    } | null): void;
    /** Set the DO alarm to the earliest pending scheduled job or cron job. */
    ensureNextAlarm(): void;
    createScheduler(): {
        runAfter: (delayMs: number, fnName: string, args?: unknown) => Promise<string>;
        runAt: (timestamp: number, fnName: string, args?: unknown) => Promise<string>;
        cancel: (id: string) => Promise<void>;
    };
    private scheduleJob;
    /** Process due scheduled jobs and cron jobs. Returns after all are handled. */
    processAlarm(executeFunction: (fnName: string, args: unknown) => Promise<void>): Promise<void>;
}
//# sourceMappingURL=CronManager.d.ts.map