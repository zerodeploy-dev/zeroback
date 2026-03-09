import { describe, it, expect, vi } from "vitest";
import { CronManager } from "./CronManager";
function makeMockSql() {
    const data = {
        cron_jobs: [],
        scheduled_jobs: [],
    };
    const sql = {
        exec(query, ...bindings) {
            const q = query.trim();
            // DELETE cron job (must be before SELECT patterns that also match "FROM cron_jobs WHERE name")
            if (q.includes("DELETE FROM cron_jobs WHERE name")) {
                data.cron_jobs = data.cron_jobs.filter((j) => j.name !== bindings[0]);
                return { toArray: () => [] };
            }
            // SELECT for cron jobs
            if (q.startsWith("SELECT") && q.includes("FROM cron_jobs WHERE name =")) {
                const name = bindings[0];
                const found = data.cron_jobs.filter((j) => j.name === name);
                return { toArray: () => found };
            }
            if (q.includes("FROM cron_jobs") && q.includes("next_run_at <=")) {
                const now = bindings[0];
                return { toArray: () => data.cron_jobs.filter((j) => j.next_run_at <= now) };
            }
            if (q.includes("SELECT name FROM cron_jobs")) {
                return { toArray: () => data.cron_jobs.map((j) => ({ name: j.name })) };
            }
            // INSERT cron job
            if (q.includes("INSERT INTO cron_jobs")) {
                data.cron_jobs.push({
                    name: bindings[0],
                    fn_name: bindings[1],
                    args: bindings[2],
                    schedule: bindings[3],
                    next_run_at: bindings[4],
                });
                return { toArray: () => [] };
            }
            // UPDATE cron job
            if (q.includes("UPDATE cron_jobs SET fn_name")) {
                const name = bindings[4];
                const job = data.cron_jobs.find((j) => j.name === name);
                if (job) {
                    job.fn_name = bindings[0];
                    job.args = bindings[1];
                    job.schedule = bindings[2];
                    job.next_run_at = bindings[3];
                }
                return { toArray: () => [] };
            }
            if (q.includes("UPDATE cron_jobs SET last_run_at")) {
                const name = bindings[2];
                const job = data.cron_jobs.find((j) => j.name === name);
                if (job) {
                    job.last_run_at = bindings[0];
                    job.next_run_at = bindings[1];
                }
                return { toArray: () => [] };
            }
            // Scheduled jobs
            if (q.includes("FROM scheduled_jobs") && q.includes("status = 'pending'") && q.includes("run_at <=")) {
                const now = bindings[0];
                return { toArray: () => data.scheduled_jobs.filter((j) => j.status === "pending" && j.run_at <= now) };
            }
            if (q.includes("INSERT INTO scheduled_jobs")) {
                data.scheduled_jobs.push({
                    id: bindings[0],
                    run_at: bindings[1],
                    fn_name: bindings[2],
                    args: bindings[3],
                    status: "pending",
                });
                return { toArray: () => [] };
            }
            if (q.includes("UPDATE scheduled_jobs SET status")) {
                const status = q.match(/status = '(\w+)'/)?.[1];
                const id = bindings[0];
                const job = data.scheduled_jobs.find((j) => j.id === id);
                if (job)
                    job.status = status;
                return { toArray: () => [] };
            }
            if (q.includes("DELETE FROM scheduled_jobs WHERE status IN")) {
                data.scheduled_jobs = data.scheduled_jobs.filter((j) => j.status === "pending" || j.status === "running");
                return { toArray: () => [] };
            }
            if (q.includes("DELETE FROM scheduled_jobs WHERE id") && q.includes("status = 'pending'")) {
                data.scheduled_jobs = data.scheduled_jobs.filter((j) => !(j.id === bindings[0] && j.status === "pending"));
                return { toArray: () => [] };
            }
            // MIN queries for ensureNextAlarm
            if (q.includes("MIN(run_at)")) {
                const pending = data.scheduled_jobs.filter((j) => j.status === "pending");
                const min = pending.length ? Math.min(...pending.map((j) => j.run_at)) : null;
                return { toArray: () => [{ next: min }] };
            }
            if (q.includes("MIN(next_run_at)")) {
                const min = data.cron_jobs.length ? Math.min(...data.cron_jobs.map((j) => j.next_run_at)) : null;
                return { toArray: () => [{ next: min }] };
            }
            return { toArray: () => [] };
        },
    };
    return { sql, data };
}
function makeCtx() {
    return {
        storage: { setAlarm: vi.fn() },
    };
}
describe("CronManager", () => {
    describe("initializeCronJobs()", () => {
        it("inserts new cron jobs", () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            cm.initializeCronJobs({
                jobs: [
                    { name: "cleanup", fnName: "internal:cleanup", args: {}, schedule: { type: "interval", ms: 3600000 } },
                ],
            });
            expect(data.cron_jobs).toHaveLength(1);
            expect(data.cron_jobs[0].name).toBe("cleanup");
            expect(ctx.storage.setAlarm).toHaveBeenCalled();
        });
        it("no-ops for null or empty jobs", () => {
            const { sql } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            cm.initializeCronJobs(null);
            cm.initializeCronJobs({ jobs: [] });
            expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
        });
        it("updates cron job when schedule changes", () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            // Initial insert
            cm.initializeCronJobs({
                jobs: [
                    { name: "cleanup", fnName: "internal:cleanup", args: {}, schedule: { type: "interval", ms: 3600000 } },
                ],
            });
            // Update with different schedule
            cm.initializeCronJobs({
                jobs: [
                    { name: "cleanup", fnName: "internal:cleanup", args: {}, schedule: { type: "interval", ms: 1800000 } },
                ],
            });
            expect(data.cron_jobs).toHaveLength(1);
        });
        it("removes cron jobs no longer in code", () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            cm.initializeCronJobs({
                jobs: [
                    { name: "a", fnName: "fn:a", args: {}, schedule: { type: "interval", ms: 1000 } },
                    { name: "b", fnName: "fn:b", args: {}, schedule: { type: "interval", ms: 1000 } },
                ],
            });
            // Now only "a" is defined
            cm.initializeCronJobs({
                jobs: [
                    { name: "a", fnName: "fn:a", args: {}, schedule: { type: "interval", ms: 1000 } },
                ],
            });
            expect(data.cron_jobs.map((j) => j.name)).toEqual(["a"]);
        });
    });
    describe("createScheduler()", () => {
        it("runAfter creates a scheduled job", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            vi.spyOn(Date, "now").mockReturnValue(1000);
            const scheduler = cm.createScheduler();
            const id = await scheduler.runAfter(5000, "fn:cleanup", { scope: "all" });
            expect(id).toBeTruthy();
            expect(data.scheduled_jobs).toHaveLength(1);
            expect(data.scheduled_jobs[0].run_at).toBe(6000); // 1000 + 5000
            expect(data.scheduled_jobs[0].fn_name).toBe("fn:cleanup");
            expect(ctx.storage.setAlarm).toHaveBeenCalled();
            vi.restoreAllMocks();
        });
        it("runAt creates a scheduled job at specific time", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            const scheduler = cm.createScheduler();
            await scheduler.runAt(99999, "fn:report");
            expect(data.scheduled_jobs[0].run_at).toBe(99999);
        });
        it("cancel removes a pending job", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            const scheduler = cm.createScheduler();
            const id = await scheduler.runAfter(5000, "fn:test");
            expect(data.scheduled_jobs).toHaveLength(1);
            await scheduler.cancel(id);
            expect(data.scheduled_jobs).toHaveLength(0);
        });
    });
    describe("processAlarm()", () => {
        it("executes due scheduled jobs", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            // Add a pending job due at time 100
            data.scheduled_jobs.push({
                id: "job-1",
                run_at: 100,
                fn_name: "fn:task",
                args: '{"x":1}',
                status: "pending",
            });
            vi.spyOn(Date, "now").mockReturnValue(200);
            const executeFn = vi.fn().mockResolvedValue(undefined);
            await cm.processAlarm(executeFn);
            expect(executeFn).toHaveBeenCalledWith("fn:task", { x: 1 });
            // Job should be cleaned up
            expect(data.scheduled_jobs.filter((j) => j.status === "pending")).toHaveLength(0);
            vi.restoreAllMocks();
        });
        it("executes due cron jobs and schedules next", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            data.cron_jobs.push({
                name: "hourly",
                fn_name: "fn:report",
                args: "{}",
                schedule: JSON.stringify({ type: "interval", ms: 3600000 }),
                next_run_at: 100,
            });
            vi.spyOn(Date, "now").mockReturnValue(200);
            const executeFn = vi.fn().mockResolvedValue(undefined);
            await cm.processAlarm(executeFn);
            expect(executeFn).toHaveBeenCalledWith("fn:report", {});
            // next_run_at should be updated
            expect(data.cron_jobs[0].next_run_at).toBeGreaterThan(200);
            expect(ctx.storage.setAlarm).toHaveBeenCalled();
            vi.restoreAllMocks();
        });
        it("handles failed scheduled jobs gracefully", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            data.scheduled_jobs.push({
                id: "job-1",
                run_at: 100,
                fn_name: "fn:fail",
                args: "{}",
                status: "pending",
            });
            vi.spyOn(Date, "now").mockReturnValue(200);
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });
            const executeFn = vi.fn().mockRejectedValue(new Error("boom"));
            await cm.processAlarm(executeFn);
            // Job should be cleaned up despite failure
            expect(data.scheduled_jobs.filter((j) => j.status === "pending")).toHaveLength(0);
            vi.restoreAllMocks();
            consoleSpy.mockRestore();
        });
        it("handles failed cron jobs and still schedules next", async () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            data.cron_jobs.push({
                name: "failing",
                fn_name: "fn:fail",
                args: "{}",
                schedule: JSON.stringify({ type: "interval", ms: 60000 }),
                next_run_at: 100,
            });
            vi.spyOn(Date, "now").mockReturnValue(200);
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });
            const executeFn = vi.fn().mockRejectedValue(new Error("fail"));
            await cm.processAlarm(executeFn);
            // Next run should still be scheduled
            expect(data.cron_jobs[0].next_run_at).toBeGreaterThan(200);
            vi.restoreAllMocks();
            consoleSpy.mockRestore();
        });
    });
    describe("ensureNextAlarm()", () => {
        it("sets alarm to earliest pending time", () => {
            const { sql, data } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            data.scheduled_jobs.push({ id: "1", run_at: 500, status: "pending" });
            data.cron_jobs.push({ name: "c", next_run_at: 300 });
            cm.ensureNextAlarm();
            expect(ctx.storage.setAlarm).toHaveBeenCalledWith(300);
        });
        it("does not set alarm when no jobs", () => {
            const { sql } = makeMockSql();
            const ctx = makeCtx();
            const cm = new CronManager(sql, ctx);
            cm.ensureNextAlarm();
            expect(ctx.storage.setAlarm).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=CronManager.test.js.map