import { describe, it, expect, afterEach } from "vitest";
import { ZerobackTestClient, sleep } from "./harness";
import WS from "ws";
// Polyfill WebSocket for Node so ZerobackClient works in tests
(globalThis as any).WebSocket = WS;
import { ZerobackClient, QueryStore } from "../packages/client/src/index";
import type { LocalStore } from "../packages/client/src/index";

let client: ZerobackTestClient;

afterEach(() => {
  client?.close();
});

async function freshClient(): Promise<ZerobackTestClient> {
  const c = new ZerobackTestClient();
  client = c;
  await c.connect();
  return c;
}

const TASK_DEFAULTS = { status: "todo", priority: "medium" };

function taskArgs(overrides: Record<string, unknown> = {}) {
  return {
    title: overrides.title ?? "test task",
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "medium",
    projectId: overrides.projectId ?? `proj-${Date.now()}`,
    ...overrides,
  } as Record<string, unknown>;
}

/**
 * Wait briefly and assert no subscription update arrives.
 */
async function expectNoUpdate(c: ZerobackTestClient, subId: string, waitMs = 1000): Promise<void> {
  let gotUpdate = false;
  const cb = c.onNextUpdate(subId, () => { gotUpdate = true; });
  await sleep(waitMs);
  cb.cancel();
  expect(gotUpdate).toBe(false);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
describe("mutations", () => {
  it("should insert a document and return void", async () => {
    const c = await freshClient();
    const result = await c.mutation("tasks:create", taskArgs());
    expect(result).toBeUndefined();
  });

  it("should reject mutation with missing required args", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: "hello",
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Missing required field/);
  });

  it("should reject mutation with wrong arg type", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: 123,
      ...TASK_DEFAULTS,
      projectId: "p",
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Expected string/);
  });
});

// ---------------------------------------------------------------------------
// Queries (with index)
// ---------------------------------------------------------------------------
describe("queries", () => {
  it("should return inserted documents via index query", async () => {
    const c = await freshClient();
    const proj = `q-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "task-1", projectId: proj }));
    await c.mutation("tasks:create", taskArgs({ title: "task-2", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result).toHaveLength(2);
    expect(result.map((t: any) => t.title).sort()).toEqual(["task-1", "task-2"]);
  });

  it("should filter by project via index — different projects return different results", async () => {
    const c = await freshClient();
    const projA = `qa-${Date.now()}`;
    const projB = `qb-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "a1", projectId: projA }));
    await c.mutation("tasks:create", taskArgs({ title: "b1", projectId: projB }));
    await c.mutation("tasks:create", taskArgs({ title: "a2", projectId: projA }));

    const { result: rA } = await c.query("tasks:listByProject", { projectId: projA });
    const { result: rB } = await c.query("tasks:listByProject", { projectId: projB });

    expect(rA.every((t: any) => t.projectId === projA)).toBe(true);
    expect(rB.every((t: any) => t.projectId === projB)).toBe(true);
    expect(rA).toHaveLength(2);
    expect(rB).toHaveLength(1);
  });

  it("should return empty array for nonexistent project", async () => {
    const c = await freshClient();
    const { result } = await c.query("tasks:listByProject", { projectId: "does-not-exist-xyz" });
    expect(result).toEqual([]);
  });

  it("should include _id and _creationTime on returned documents", async () => {
    const c = await freshClient();
    const proj = `meta-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "meta-test", projectId: proj }));
    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result).toHaveLength(1);
    const doc = result[0];
    expect(doc._id).toMatch(/^tasks:/);
    expect(typeof doc._creationTime).toBe("number");
    expect(doc._creationTime).toBeGreaterThan(0);
  });

  it("should respect order(desc) — newest first", async () => {
    const c = await freshClient();
    const proj = `order-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "first", projectId: proj }));
    await sleep(10);
    await c.mutation("tasks:create", taskArgs({ title: "second", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result[0].title).toBe("second");
    expect(result[1].title).toBe("first");
  });

  it("should return error for unknown function", async () => {
    const c = await freshClient();
    const err = await c.queryError("nonexistent:func", {});
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Function not found/);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
describe("pagination", () => {
  it("should paginate through results", async () => {
    const c = await freshClient();
    const proj = `pag-${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      await c.mutation("tasks:create", taskArgs({ title: `pag-${i}`, projectId: proj }));
    }

    // Page 1
    const { result: page1 } = await c.query("tasks:listPaginated", { projectId: proj, numItems: 2 });
    expect(page1.page).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeTruthy();

    // Page 2
    const { result: page2 } = await c.query("tasks:listPaginated", {
      projectId: proj, numItems: 2, cursor: page1.continueCursor,
    });
    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(false);

    // Page 3 — last
    const { result: page3 } = await c.query("tasks:listPaginated", {
      projectId: proj, numItems: 2, cursor: page2.continueCursor,
    });
    expect(page3.page).toHaveLength(1);
    expect(page3.isDone).toBe(true);
    expect(page3.continueCursor).toBeNull();
  });

  it("should paginate with page size 1 without duplicates or gaps (keyset tiebreaker)", async () => {
    const c = await freshClient();
    const proj = `pag-keyset-${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      await c.mutation("tasks:create", taskArgs({ title: `k-${i}`, projectId: proj }));
    }

    const allTitles: string[] = [];
    let cursor: string | undefined = undefined;
    let pages = 0;

    while (pages < 10) { // safety limit
      const args: Record<string, unknown> = { projectId: proj, numItems: 1 };
      if (cursor !== undefined) args.cursor = cursor;
      const { result } = await c.query("tasks:listPaginated", args);
      for (const doc of result.page) {
        allTitles.push(doc.title);
      }
      pages++;
      if (result.isDone) break;
      cursor = result.continueCursor ?? undefined;
    }

    expect(allTitles).toHaveLength(5);
    // No duplicates
    expect(new Set(allTitles).size).toBe(5);
    // All items present (order is desc, so k-4 first)
    expect(allTitles.sort()).toEqual(["k-0", "k-1", "k-2", "k-3", "k-4"]);
  });

  it("should return all results when numItems exceeds total", async () => {
    const c = await freshClient();
    const proj = `pag-all-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "one", projectId: proj }));
    await c.mutation("tasks:create", taskArgs({ title: "two", projectId: proj }));

    const { result } = await c.query("tasks:listPaginated", { projectId: proj, numItems: 100 });
    expect(result.page).toHaveLength(2);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-time subscriptions
// ---------------------------------------------------------------------------
describe("subscriptions", () => {
  it("should push update when a new task is inserted into the subscribed project", async () => {
    const c = await freshClient();
    const proj = `sub-${Date.now()}`;

    const { id: subId, result: initial } = await c.query("tasks:listByProject", { projectId: proj });
    expect(initial).toEqual([]);

    const updatePromise = c.waitForUpdate(subId);
    await c.mutation("tasks:create", taskArgs({ title: "live!", projectId: proj }));

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("live!");
  });

  it("should NOT push update for a different project", async () => {
    const c = await freshClient();
    const proj1 = `sub-iso-1-${Date.now()}`;
    const proj2 = `sub-iso-2-${Date.now()}`;

    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj1 });

    // Insert into a different project
    await c.mutation("tasks:create", taskArgs({ title: "wrong-project", projectId: proj2 }));

    await expectNoUpdate(c, subId);
  });

  it("should push multiple sequential updates", async () => {
    const c = await freshClient();
    const proj = `sub-multi-${Date.now()}`;

    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj });

    const p1 = c.waitForUpdate(subId);
    await c.mutation("tasks:create", taskArgs({ title: "task-1", projectId: proj }));
    const r1 = await p1;
    expect(r1).toHaveLength(1);

    const p2 = c.waitForUpdate(subId);
    await c.mutation("tasks:create", taskArgs({ title: "task-2", projectId: proj }));
    const r2 = await p2;
    expect(r2).toHaveLength(2);
  });

  it("should stop receiving updates after unsubscribe", async () => {
    const c = await freshClient();
    const proj = `sub-unsub-${Date.now()}`;

    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj });

    // Verify subscription works
    const p1 = c.waitForUpdate(subId);
    await c.mutation("tasks:create", taskArgs({ title: "before", projectId: proj }));
    await p1;

    // Unsubscribe
    c.unsubscribe(subId);
    await sleep(200);

    // Insert another task — should NOT trigger update
    await c.mutation("tasks:create", taskArgs({ title: "after", projectId: proj }));
    await expectNoUpdate(c, subId);
  });
});

// ---------------------------------------------------------------------------
// Multiple clients
// ---------------------------------------------------------------------------
describe("multiple clients", () => {
  let client2: ZerobackTestClient;

  afterEach(() => {
    client2?.close();
  });

  it("client2 should see mutations from client1 via subscription", async () => {
    const c1 = await freshClient();
    client2 = new ZerobackTestClient();
    await client2.connect();

    const proj = `multi-${Date.now()}`;

    const { id: subId } = await client2.query("tasks:listByProject", { projectId: proj });

    const updatePromise = client2.waitForUpdate(subId);
    await c1.mutation("tasks:create", taskArgs({ title: "from-c1", projectId: proj }));

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("from-c1");
  });

  it("both clients can query independently", async () => {
    const c1 = await freshClient();
    client2 = new ZerobackTestClient();
    await client2.connect();

    const proj = `multi-q-${Date.now()}`;
    await c1.mutation("tasks:create", taskArgs({ title: "shared", projectId: proj }));

    const { result: r1 } = await c1.query("tasks:listByProject", { projectId: proj });
    const { result: r2 } = await client2.query("tasks:listByProject", { projectId: proj });

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0]._id).toBe(r2[0]._id);
  });
});

// ---------------------------------------------------------------------------
// Arg validation
// ---------------------------------------------------------------------------
describe("arg validation", () => {
  it("should reject number where string expected", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: 42,
      ...TASK_DEFAULTS,
      projectId: "val",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should reject boolean where string expected", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: true,
      ...TASK_DEFAULTS,
      projectId: "val",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should reject null where string expected", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: null,
      ...TASK_DEFAULTS,
      projectId: "val",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should accept optional args as undefined", async () => {
    const c = await freshClient();
    const proj = `opt-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ projectId: proj }));

    // listPaginated has optional cursor and numItems
    const { result } = await c.query("tasks:listPaginated", { projectId: proj });
    expect(result.page).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------
describe("document structure", () => {
  it("each document should have a unique _id", async () => {
    const c = await freshClient();
    const proj = `unique-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "a", projectId: proj }));
    await c.mutation("tasks:create", taskArgs({ title: "b", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    const ids = result.map((t: any) => t._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("_id should be prefixed with table name", async () => {
    const c = await freshClient();
    const proj = `prefix-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "x", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result[0]._id).toMatch(/^tasks:/);
  });

  it("_creationTime should be monotonically increasing", async () => {
    const c = await freshClient();
    const proj = `mono-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "first", projectId: proj }));
    await sleep(5);
    await c.mutation("tasks:create", taskArgs({ title: "second", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    // order("desc") so newest first
    expect(result[0]._creationTime).toBeGreaterThanOrEqual(result[1]._creationTime);
  });

  it("documents should preserve all user-supplied fields", async () => {
    const c = await freshClient();
    const proj = `fields-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "my task", projectId: proj }));

    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result[0]).toMatchObject({ title: "my task", status: "todo", priority: "medium", projectId: proj });
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
describe("actions", () => {
  it("should run an action that calls runMutation and runQuery", async () => {
    const c = await freshClient();
    const proj = `action-${Date.now()}`;
    const result = await c.action("tasks:createViaAction", {
      title: "from action",
      ...TASK_DEFAULTS,
      projectId: proj,
    });
    expect(result.created).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);

    // Verify the task was actually written
    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("from action");
  });

  it("action mutations should trigger subscription updates", async () => {
    const c = await freshClient();
    const proj = `action-sub-${Date.now()}`;

    // Subscribe first
    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj });

    // Create via action
    const updatePromise = c.waitForUpdate(subId);
    await c.action("tasks:createViaAction", {
      title: "action update",
      ...TASK_DEFAULTS,
      projectId: proj,
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("action update");
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
describe("scheduler", () => {
  it("should schedule a mutation to run after a delay", async () => {
    const c = await freshClient();
    const proj = `sched-${Date.now()}`;

    // Subscribe before scheduling
    const { id: subId, result: initial } = await c.query("tasks:listByProject", { projectId: proj });
    expect(initial).toHaveLength(0);

    // Schedule a task to be created after 100ms
    const jobId = await c.mutation("tasks:scheduleCreate", {
      title: "scheduled task",
      ...TASK_DEFAULTS,
      projectId: proj,
      delayMs: 100,
    });
    expect(typeof jobId).toBe("string");

    // Wait for the subscription update (triggered when scheduled job runs)
    const updated = await c.waitForUpdate(subId, 5000);
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("scheduled task");
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoints
// ---------------------------------------------------------------------------
describe("http", () => {
  it("GET /health should return 200 OK", async () => {
    const res = await fetch("http://localhost:8788/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("GET /unknown should return 404", async () => {
    const res = await fetch("http://localhost:8788/unknown");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// HTTP actions
// ---------------------------------------------------------------------------
describe("http actions", () => {
  it("POST /api/tasks should insert a task via HTTP action", async () => {
    const proj = `http-action-${Date.now()}`;
    const res = await fetch("http://localhost:8788/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "via http", ...TASK_DEFAULTS, projectId: proj }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify the task was actually persisted by querying via WS
    const c = await freshClient();
    const { result } = await c.query("tasks:listByProject", { projectId: proj });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("via http");
  });

  it("GET /api/tasks should return tasks via HTTP action", async () => {
    const proj = `http-get-${Date.now()}`;

    // Insert via WS first
    const c = await freshClient();
    await c.mutation("tasks:create", taskArgs({ title: "t1", projectId: proj }));
    await c.mutation("tasks:create", taskArgs({ title: "t2", projectId: proj }));

    // Read via HTTP
    const res = await fetch(`http://localhost:8788/api/tasks?projectId=${proj}`);
    expect(res.status).toBe(200);
    const tasks = await res.json();
    expect(tasks).toHaveLength(2);
  });

  it("HTTP action mutations should trigger WS subscription updates", async () => {
    const proj = `http-sub-${Date.now()}`;
    const c = await freshClient();

    // Subscribe via WS
    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj });

    // Insert via HTTP action
    const updatePromise = c.waitForUpdate(subId);
    await fetch("http://localhost:8788/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "http push", ...TASK_DEFAULTS, projectId: proj }),
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("http push");
  });
});

// ---------------------------------------------------------------------------
// Internal Functions
// ---------------------------------------------------------------------------
describe("internal functions", () => {
  it("rejects client calls to internalQuery", async () => {
    const c = await freshClient();
    const err = await c.queryError("tasks:countInternal", { projectId: "general" });
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("internal");
  });

  it("rejects client calls to internalMutation", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:createInternal", {
      title: "test",
      ...TASK_DEFAULTS,
      projectId: "general",
    });
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("internal");
  });

  it("allows server-side code to call internal functions via action", async () => {
    const c = await freshClient();
    const proj = `internal-${Date.now()}`;

    // createViaInternal is a public action that calls createInternal + countInternal
    const result = await c.action("tasks:createViaInternal", {
      title: "from action",
      ...TASK_DEFAULTS,
      projectId: proj,
    });

    expect(result.created).toBe(true);
    expect(result.count).toBe(1);

    // Verify the task was actually created
    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("from action");
  });

  it("internal mutations trigger subscription updates", async () => {
    const c = await freshClient();
    const proj = `internal-sub-${Date.now()}`;

    // Subscribe to the project
    const { id: subId } = await c.query("tasks:listByProject", { projectId: proj });

    // Use the public action which calls the internal mutation
    const updatePromise = c.waitForUpdate(subId);
    await c.action("tasks:createViaInternal", {
      title: "internal push",
      ...TASK_DEFAULTS,
      projectId: proj,
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].title).toBe("internal push");
  });
});

// ---------------------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------------------
describe("cron jobs", () => {
  it("cron job executes on schedule and triggers subscription update", async () => {
    const c = await freshClient();
    const proj = "cron-cleanup";

    // Insert a task into the cron-cleanup project
    await c.mutation("tasks:create", taskArgs({ title: "will be cleaned", projectId: proj }));

    // Verify it exists
    const { id: subId, result: before } = await c.query("tasks:listByProject", { projectId: proj });
    const countBefore = before.length;
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // The cron job runs every 5 seconds and deletes tasks in "cron-cleanup" project.
    // Wait for the cron to fire and delete them.
    const updated = await c.waitForUpdate(subId, 10_000);

    // After cron runs, tasks should be empty
    expect(updated.length).toBeLessThan(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Scheduler Cancel
// ---------------------------------------------------------------------------
describe("scheduler.cancel", () => {
  it("cancels a scheduled job before it runs", async () => {
    const c = await freshClient();
    const proj = `cancel-${Date.now()}`;

    // Schedule a task to be created in 2 seconds
    const jobId = await c.mutation("tasks:scheduleCreate", {
      title: "should not appear",
      ...TASK_DEFAULTS,
      projectId: proj,
      delayMs: 2000,
    });

    // Cancel it immediately
    await c.mutation("tasks:cancelScheduled", { jobId });

    // Wait 3 seconds — the task should NOT have been created
    await sleep(3000);

    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    expect(tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ctx.runAction() — action-to-action calls
// ---------------------------------------------------------------------------
describe("ctx.runAction", () => {
  it("action can call another action via runAction", async () => {
    const c = await freshClient();
    const proj = `run-action-${Date.now()}`;

    // createAndCount calls createViaAction, which calls runMutation + runQuery
    const result = await c.action("tasks:createAndCount", {
      title: "nested action",
      ...TASK_DEFAULTS,
      projectId: proj,
    });

    expect(result.calledFrom).toBe("createAndCount");
    expect(result.innerResult.created).toBe(true);
    expect(result.innerResult.count).toBe(1);

    // Verify the task was created
    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("nested action");
  });
});

// ---------------------------------------------------------------------------
// Schema enforcement on writes
// ---------------------------------------------------------------------------
describe("schema enforcement", () => {
  it("rejects insert with wrong field type", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: 999,
      status: "todo",
      priority: "medium",
      projectId: "schema-test",
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Expected string/);
  });

  it("rejects insert with extra field", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: "test",
      status: "todo",
      priority: "medium",
      projectId: "schema-test",
      nonExistentField: "should fail",
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Unexpected field/);
  });

  it("rejects insert with missing required field", async () => {
    const c = await freshClient();
    const err = await c.mutationError("tasks:create", {
      title: "test",
      // missing status, priority, projectId
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Missing required field/);
  });

  it("rejects patch with wrong field type", async () => {
    const c = await freshClient();
    const proj = `schema-patch-${Date.now()}`;
    await c.mutation("tasks:create", taskArgs({ title: "to-patch", projectId: proj }));

    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    const id = tasks[0]._id;

    const err = await c.mutationError("tasks:update", {
      id,
      title: 123,
    } as any);
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Expected string/);
  });
});

// ---------------------------------------------------------------------------
// v.record() validator
// ---------------------------------------------------------------------------
describe("v.record", () => {
  it("accepts valid record args", async () => {
    const c = await freshClient();
    const proj = `record-${Date.now()}`;

    const result = await c.mutation("tasks:createWithMetadata", {
      title: "with metadata",
      ...TASK_DEFAULTS,
      projectId: proj,
      metadata: { color: "red", size: "large" },
    });

    expect(result.metadataKeys).toEqual(["color", "size"]);

    // Verify task was created
    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    expect(tasks).toHaveLength(1);
  });

  it("rejects invalid record values", async () => {
    const c = await freshClient();
    const proj = `record-inv-${Date.now()}`;

    const err = await c.mutationError("tasks:createWithMetadata", {
      title: "bad",
      ...TASK_DEFAULTS,
      projectId: proj,
      metadata: { color: 123 },
    } as any);

    expect(err.code).toBe("execution_error");
    expect(err.message).toContain("Expected string");
  });
});

// ---------------------------------------------------------------------------
// Return value validators
// ---------------------------------------------------------------------------
describe("return value validators", () => {
  it("returns validated value from query with returns validator", async () => {
    const c = await freshClient();
    const proj = `returns-${Date.now()}`;

    // countByProject has returns: v.number()
    const { result: count } = await c.query("tasks:countByProject", { projectId: proj });
    expect(typeof count).toBe("number");
    expect(count).toBe(0);

    // Add a task and re-query
    await c.mutation("tasks:create", taskArgs({ projectId: proj }));
    const { result: count2 } = await c.query("tasks:countByProject", { projectId: proj });
    expect(count2).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nested Directory Functions
// ---------------------------------------------------------------------------
describe("nested directory functions", () => {
  it("calls a function in a nested directory (utils/stats:taskStats)", async () => {
    const c = await freshClient();
    const proj = `nested-${Date.now()}`;

    // Insert some tasks
    await c.mutation("tasks:create", taskArgs({ title: "a", projectId: proj, status: "todo" }));
    await c.mutation("tasks:create", taskArgs({ title: "b", projectId: proj, status: "done" }));

    // Call the nested function
    const { result } = await c.query("utils/stats:taskStats", { projectId: proj });
    expect(result.projectId).toBe(proj);
    expect(result.total).toBe(2);
    expect(result.todo).toBe(1);
    expect(result.done).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Default Indexes (by_id)
// ---------------------------------------------------------------------------
describe("default indexes", () => {
  it("by_id returns documents ordered by creation time (ULID)", async () => {
    const c = await freshClient();
    const proj = `default-idx-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "first", projectId: proj }));
    await sleep(10);
    await c.mutation("tasks:create", taskArgs({ title: "second", projectId: proj }));
    await sleep(10);
    await c.mutation("tasks:create", taskArgs({ title: "third", projectId: proj }));

    // recent uses by_id index with order("desc")
    const { result } = await c.query("tasks:recent", { limit: 100 });

    // Should include our tasks (and possibly others) in desc creation order
    const ours = result.filter((t: any) => t.projectId === proj);
    expect(ours).toHaveLength(3);
    expect(ours[0].title).toBe("third");
    expect(ours[1].title).toBe("second");
    expect(ours[2].title).toBe("first");

    // Verify _creationTime is monotonically decreasing (derived from ULID)
    expect(ours[0]._creationTime).toBeGreaterThanOrEqual(ours[1]._creationTime);
    expect(ours[1]._creationTime).toBeGreaterThanOrEqual(ours[2]._creationTime);
  });

  it("by_id index allows lookup by _id", async () => {
    const c = await freshClient();
    const proj = `byid-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "find me", projectId: proj }));
    const { result: tasks } = await c.query("tasks:listByProject", { projectId: proj });
    const id = tasks[0]._id;

    // getById uses by_id index with eq("_id", id)
    const { result: found } = await c.query("tasks:getById", { id });
    expect(found).not.toBeNull();
    expect(found._id).toBe(id);
    expect(found.title).toBe("find me");
  });

  it("by_id returns null for nonexistent id", async () => {
    const c = await freshClient();
    const { result: found } = await c.query("tasks:getById", { id: "nonexistent_12345" });
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boolean compound index queries
// ---------------------------------------------------------------------------
describe("boolean compound index queries", () => {
  it("should return documents matching boolean false in compound index", async () => {
    const c = await freshClient();
    const proj = `bool-idx-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "incomplete-1", projectId: proj, isCompleted: false }));
    await c.mutation("tasks:create", taskArgs({ title: "incomplete-2", projectId: proj, isCompleted: false }));
    await c.mutation("tasks:create", taskArgs({ title: "complete-1", projectId: proj, isCompleted: true }));

    const { result: incomplete } = await c.query("tasks:listByProjectCompleted", {
      projectId: proj, isCompleted: false,
    });
    expect(incomplete).toHaveLength(2);
    expect(incomplete.every((t: any) => t.isCompleted === false)).toBe(true);
  });

  it("should return documents matching boolean true in compound index", async () => {
    const c = await freshClient();
    const proj = `bool-idx-true-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "incomplete-1", projectId: proj, isCompleted: false }));
    await c.mutation("tasks:create", taskArgs({ title: "complete-1", projectId: proj, isCompleted: true }));
    await c.mutation("tasks:create", taskArgs({ title: "complete-2", projectId: proj, isCompleted: true }));

    const { result: complete } = await c.query("tasks:listByProjectCompleted", {
      projectId: proj, isCompleted: true,
    });
    expect(complete).toHaveLength(2);
    expect(complete.every((t: any) => t.isCompleted === true)).toBe(true);
  });

  it("should return empty when no documents match boolean value", async () => {
    const c = await freshClient();
    const proj = `bool-idx-empty-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "only-complete", projectId: proj, isCompleted: true }));

    const { result: incomplete } = await c.query("tasks:listByProjectCompleted", {
      projectId: proj, isCompleted: false,
    });
    expect(incomplete).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Optimistic Updates (via ZerobackClient)
// ---------------------------------------------------------------------------
describe("optimistic updates", () => {
  let convexClient: ZerobackClient;

  afterEach(() => {
    convexClient?.close();
  });

  it("applies optimistic update immediately and reverts to server truth", async () => {
    convexClient = new ZerobackClient("ws://localhost:8788/ws");

    // Wait for connection
    await new Promise<void>((resolve) => {
      const unsub = convexClient.onConnectionChange((state) => {
        if (state === "connected") { unsub(); resolve(); }
      });
      if (convexClient.connectionState === "connected") resolve();
    });

    const proj = `opt-update-${Date.now()}`;
    const queryKey = QueryStore.makeKey("tasks:listByProject", { projectId: proj });

    // Subscribe to the query
    convexClient.subscribe("tasks:listByProject", { projectId: proj });

    // Wait for initial result
    await new Promise<void>((resolve) => {
      const unsub = convexClient.watchQuery(queryKey, () => {
        const result = convexClient.getQueryResult(queryKey);
        if (result !== undefined) { unsub(); resolve(); }
      });
    });

    const before = convexClient.getQueryResult(queryKey) as any[];
    expect(before).toEqual([]);

    // Perform mutation with optimistic update
    const mutationPromise = convexClient.mutation(
      "tasks:create",
      { title: "optimistic task", status: "todo", priority: "medium", projectId: proj },
      {
        optimisticUpdate: (store: LocalStore) => {
          const current = store.getQuery("tasks:listByProject", { projectId: proj }) as any[];
          store.setQuery("tasks:listByProject", { projectId: proj }, [
            ...current,
            { _id: "temp", _creationTime: Date.now(), title: "optimistic task", status: "todo", priority: "medium", projectId: proj },
          ]);
        },
      },
    );

    // Immediately after calling mutation, optimistic result should be visible
    const optimistic = convexClient.getQueryResult(queryKey) as any[];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].title).toBe("optimistic task");
    expect(optimistic[0]._id).toBe("temp");

    // Wait for mutation to complete
    await mutationPromise;

    // After mutation resolves, optimistic layer is removed.
    // Wait for server push to update the base cache.
    await new Promise<void>((resolve) => {
      const check = () => {
        const result = convexClient.getQueryResult(queryKey) as any[];
        if (result && result.length > 0 && result[0]._id !== "temp") {
          resolve();
        }
      };
      check();
      const unsub = convexClient.watchQuery(queryKey, () => {
        check();
        if ((convexClient.getQueryResult(queryKey) as any[])?.[0]?._id !== "temp") {
          unsub();
        }
      });
      setTimeout(() => { unsub(); resolve(); }, 5000);
    });

    // Server truth should have the real task with a real _id
    const serverResult = convexClient.getQueryResult(queryKey) as any[];
    expect(serverResult).toHaveLength(1);
    expect(serverResult[0].title).toBe("optimistic task");
    expect(serverResult[0]._id).not.toBe("temp");
  });

  it("reverts optimistic update on mutation failure", async () => {
    convexClient = new ZerobackClient("ws://localhost:8788/ws");

    await new Promise<void>((resolve) => {
      const unsub = convexClient.onConnectionChange((state) => {
        if (state === "connected") { unsub(); resolve(); }
      });
      if (convexClient.connectionState === "connected") resolve();
    });

    const proj = `opt-revert-${Date.now()}`;
    const queryKey = QueryStore.makeKey("tasks:listByProject", { projectId: proj });

    convexClient.subscribe("tasks:listByProject", { projectId: proj });

    // Wait for initial result
    await new Promise<void>((resolve) => {
      const unsub = convexClient.watchQuery(queryKey, () => {
        if (convexClient.getQueryResult(queryKey) !== undefined) { unsub(); resolve(); }
      });
    });

    expect(convexClient.getQueryResult(queryKey)).toEqual([]);

    // Mutation that will fail (missing required args)
    const mutationPromise = convexClient.mutation(
      "tasks:create",
      { title: "fail" } as any, // missing status, priority, projectId
      {
        optimisticUpdate: (store: LocalStore) => {
          store.setQuery("tasks:listByProject", { projectId: proj }, [
            { _id: "temp", title: "should revert" },
          ]);
        },
      },
    ).catch(() => {}); // swallow expected error

    // Optimistic update is visible immediately
    const optimistic = convexClient.getQueryResult(queryKey) as any[];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].title).toBe("should revert");

    // Wait for mutation to fail
    await mutationPromise;

    // After failure, optimistic layer is removed — reverts to empty
    const reverted = convexClient.getQueryResult(queryKey) as any[];
    expect(reverted).toEqual([]);
  });

  it("only notifies listeners for affected query keys", async () => {
    convexClient = new ZerobackClient("ws://localhost:8788/ws");

    await new Promise<void>((resolve) => {
      const unsub = convexClient.onConnectionChange((state) => {
        if (state === "connected") { unsub(); resolve(); }
      });
      if (convexClient.connectionState === "connected") resolve();
    });

    const projA = `opt-a-${Date.now()}`;
    const projB = `opt-b-${Date.now()}`;
    const keyA = QueryStore.makeKey("tasks:listByProject", { projectId: projA });
    const keyB = QueryStore.makeKey("tasks:listByProject", { projectId: projB });

    convexClient.subscribe("tasks:listByProject", { projectId: projA });
    convexClient.subscribe("tasks:listByProject", { projectId: projB });

    // Wait for both subscriptions
    await new Promise<void>((resolve) => {
      let gotA = false, gotB = false;
      const check = () => { if (gotA && gotB) resolve(); };
      const unsubA = convexClient.watchQuery(keyA, () => {
        if (convexClient.getQueryResult(keyA) !== undefined) { gotA = true; unsubA(); check(); }
      });
      const unsubB = convexClient.watchQuery(keyB, () => {
        if (convexClient.getQueryResult(keyB) !== undefined) { gotB = true; unsubB(); check(); }
      });
    });

    let notifyCountB = 0;
    const unsubB = convexClient.watchQuery(keyB, () => { notifyCountB++; });

    // Optimistic update only touches project A
    await convexClient.mutation(
      "tasks:create",
      { title: "hi", status: "todo", priority: "medium", projectId: projA },
      {
        optimisticUpdate: (store: LocalStore) => {
          const current = store.getQuery("tasks:listByProject", { projectId: projA }) as any[];
          store.setQuery("tasks:listByProject", { projectId: projA }, [
            ...current,
            { _id: "temp", title: "hi" },
          ]);
        },
      },
    );

    unsubB();

    // Project B listener should NOT have been notified by the optimistic update
    expect(notifyCountB).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// File Storage (R2)
// ---------------------------------------------------------------------------
describe("file storage", () => {
  const PORT = 8788;

  it("should generate upload URL, upload file, and download it", async () => {
    const c = await freshClient();

    // Generate upload URL via mutation
    const uploadUrl = await c.mutation("storage:generateUploadUrl");
    expect(uploadUrl).toContain("/storage/upload?token=");

    // Upload a file to the URL
    const fileContent = "Hello, Vex storage!";
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: fileContent,
    });
    expect(uploadRes.ok).toBe(true);
    const { storageId } = await uploadRes.json() as { storageId: string };
    expect(storageId).toMatch(/^_storage\//);

    // Get the file URL
    const { result: fileUrl } = await c.query("storage:getFileUrl", { storageId });
    expect(fileUrl).toContain(`/storage/${storageId}`);

    // Download and verify content
    const downloadRes = await fetch(fileUrl!);
    expect(downloadRes.ok).toBe(true);
    expect(downloadRes.headers.get("Content-Type")).toBe("text/plain");
    const downloaded = await downloadRes.text();
    expect(downloaded).toBe(fileContent);
  });

  it("should return correct metadata for uploaded file", async () => {
    const c = await freshClient();

    const uploadUrl = await c.mutation("storage:generateUploadUrl");
    const content = "metadata test content";
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: content,
    });
    const { storageId } = await uploadRes.json() as { storageId: string };

    const { result: meta } = await c.query("storage:getFileMetadata", { storageId });
    expect(meta).not.toBeNull();
    expect(meta.storageId).toBe(storageId);
    expect(meta.contentType).toBe("application/json");
    expect(meta.size).toBe(new TextEncoder().encode(content).length);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should delete file from both SQLite and R2", async () => {
    const c = await freshClient();

    const uploadUrl = await c.mutation("storage:generateUploadUrl");
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "delete me",
    });
    const { storageId } = await uploadRes.json() as { storageId: string };

    // Verify file exists
    const { result: urlBefore } = await c.query("storage:getFileUrl", { storageId });
    expect(urlBefore).not.toBeNull();

    // Delete
    await c.mutation("storage:deleteFile", { storageId });

    // Verify metadata gone
    const { result: urlAfter } = await c.query("storage:getFileUrl", { storageId });
    expect(urlAfter).toBeNull();

    // Verify R2 object gone (download returns 404)
    const downloadRes = await fetch(urlBefore!);
    expect(downloadRes.status).toBe(404);
  });

  it("should store blob from action context", async () => {
    const c = await freshClient();

    const storageId = await c.action("storage:storeFromAction", {
      content: "action-stored content",
      contentType: "text/plain",
    });
    expect(storageId).toMatch(/^_storage\//);

    // Verify metadata
    const { result: meta } = await c.query("storage:getFileMetadata", { storageId });
    expect(meta).not.toBeNull();
    expect(meta.contentType).toBe("text/plain");
    expect(meta.size).toBe(new TextEncoder().encode("action-stored content").length);
  });

  it("should reject upload with invalid token", async () => {
    const uploadRes = await fetch(
      `http://localhost:${PORT}/storage/upload?token=invalid-token-123`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "should fail",
      }
    );
    expect(uploadRes.status).toBe(403);
  });

  it("should reject upload with missing token", async () => {
    const uploadRes = await fetch(
      `http://localhost:${PORT}/storage/upload`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "should fail",
      }
    );
    expect(uploadRes.status).toBe(400);
  });

  it("should reject reuse of one-time upload token", async () => {
    const c = await freshClient();

    const uploadUrl = await c.mutation("storage:generateUploadUrl");

    // First upload succeeds
    const res1 = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "first upload",
    });
    expect(res1.ok).toBe(true);

    // Second upload with same token fails
    const res2 = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "second upload",
    });
    expect(res2.status).toBe(403);
  });

  it("getUrl returns null for nonexistent storageId", async () => {
    const c = await freshClient();
    const { result } = await c.query("storage:getFileUrl", { storageId: "_storage/nonexistent" });
    expect(result).toBeNull();
  });

  it("getMetadata returns null for nonexistent storageId", async () => {
    const c = await freshClient();
    const { result } = await c.query("storage:getFileMetadata", { storageId: "_storage/nonexistent" });
    expect(result).toBeNull();
  });
});
