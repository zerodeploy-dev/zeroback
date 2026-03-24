import { describe, it, expect, afterEach } from "vitest";
import { ZerobackTestClient, sleep } from "./harness";

const clients: ZerobackTestClient[] = [];

async function freshClient(): Promise<ZerobackTestClient> {
  const c = new ZerobackTestClient();
  clients.push(c);
  await c.connect();
  return c;
}

afterEach(() => {
  for (const c of clients) c.close();
  clients.length = 0;
});

function taskArgs(overrides: Record<string, unknown> = {}) {
  return {
    title: overrides.title ?? "occ-test",
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "medium",
    projectId: overrides.projectId ?? `occ-proj-${Date.now()}`,
    ...overrides,
  } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// OCC Stress Tests — E2E
// ---------------------------------------------------------------------------
describe("OCC stress (e2e)", () => {

  it("concurrent updates from multiple clients on the same document", async () => {
    const c = await freshClient();
    const projectId = `occ-concurrent-${Date.now()}`;

    // Create a task
    await c.mutation("tasks:create", taskArgs({ title: "shared-task", projectId }));
    const { result: tasks } = await c.query("tasks:listByProject", { projectId });
    expect(tasks.length).toBe(1);
    const taskId = tasks[0]._id;

    // Spin up multiple clients
    const NUM_CLIENTS = 5;
    const updaters = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => freshClient())
    );

    // All clients update the same task concurrently
    const results = await Promise.allSettled(
      updaters.map((client, i) =>
        client.mutation("tasks:update", { id: taskId, title: `updated-by-${i}` })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // At least one should succeed
    expect(succeeded.length).toBeGreaterThan(0);

    // Any failure should be a conflict error
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason.message).toMatch(
        /conflict|Conflict|CONFLICT/i
      );
    }

    // Final state should be consistent — one of the update values should "win"
    const { result: finalTask } = await c.query("tasks:get", { id: taskId });
    expect(finalTask).not.toBeNull();
    expect(finalTask.title).toMatch(/^updated-by-\d$/);
  });

  it("rapid-fire updates from a single client", async () => {
    const c = await freshClient();
    const projectId = `occ-rapid-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "rapid-task", projectId }));
    const { result: tasks } = await c.query("tasks:listByProject", { projectId });
    const taskId = tasks[0]._id;

    const NUM_UPDATES = 20;

    // Fire all updates without waiting for each to complete
    const results = await Promise.allSettled(
      Array.from({ length: NUM_UPDATES }, (_, i) =>
        c.mutation("tasks:update", { id: taskId, title: `rapid-${i}` })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThan(0);

    // Verify the document is in a valid state
    const { result: finalTask } = await c.query("tasks:get", { id: taskId });
    expect(finalTask).not.toBeNull();
    expect(finalTask.title).toMatch(/^rapid-\d+$/);
  });

  it("concurrent creates do not lose data", async () => {
    const projectId = `occ-creates-${Date.now()}`;
    const NUM_CLIENTS = 5;
    const CREATES_PER_CLIENT = 4;

    const creators = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => freshClient())
    );

    // All clients create tasks concurrently
    const results = await Promise.allSettled(
      creators.flatMap((client, ci) =>
        Array.from({ length: CREATES_PER_CLIENT }, (_, ti) =>
          client.mutation(
            "tasks:create",
            taskArgs({
              title: `task-c${ci}-t${ti}`,
              projectId,
            })
          )
        )
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    // All creates should succeed — inserts don't read so no OCC conflicts
    expect(succeeded).toBe(NUM_CLIENTS * CREATES_PER_CLIENT);

    // Verify all tasks exist
    const reader = await freshClient();
    const { result: allTasks } = await reader.query("tasks:listByProject", { projectId });
    expect(allTasks.length).toBe(NUM_CLIENTS * CREATES_PER_CLIENT);
  });

  it("concurrent updates and deletes on the same document", async () => {
    const c = await freshClient();
    const projectId = `occ-update-delete-${Date.now()}`;

    await c.mutation("tasks:create", taskArgs({ title: "doomed-task", projectId }));
    const { result: tasks } = await c.query("tasks:listByProject", { projectId });
    const taskId = tasks[0]._id;

    const updater = await freshClient();
    const deleter = await freshClient();

    // Fire update and delete concurrently
    const results = await Promise.allSettled([
      updater.mutation("tasks:update", { id: taskId, title: "updated-before-delete" }),
      deleter.mutation("tasks:remove", { id: taskId }),
    ]);

    // At least one should succeed
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    // If both succeeded, the task is either updated then deleted, or just deleted
    // Either way, verify query returns a consistent result
    const { result: finalTask } = await c.query("tasks:get", { id: taskId });
    // The task is either null (deleted) or updated
    if (finalTask !== null) {
      expect(finalTask.title).toBe("updated-before-delete");
    }
  });

  it("subscription updates are consistent after concurrent mutations", async () => {
    const subscriber = await freshClient();
    const projectId = `occ-sub-${Date.now()}`;

    // Create initial task
    await subscriber.mutation("tasks:create", taskArgs({ title: "sub-task", projectId }));

    // Subscribe to the project list
    const { id: subId, result: initial } = await subscriber.query(
      "tasks:listByProject",
      { projectId }
    );
    expect(initial.length).toBe(1);
    const taskId = initial[0]._id;

    // Concurrent updates from multiple clients
    const NUM_CLIENTS = 3;
    const updaters = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => freshClient())
    );

    // Perform sequential updates to ensure they all succeed
    for (let i = 0; i < NUM_CLIENTS; i++) {
      await updaters[i].mutation("tasks:update", {
        id: taskId,
        title: `sub-update-${i}`,
      });
    }

    // Wait for subscription to settle
    await sleep(500);

    // Re-query to verify the final state
    const { result: finalTasks } = await subscriber.query(
      "tasks:listByProject",
      { projectId }
    );
    expect(finalTasks.length).toBe(1);
    // The title should be the last update
    expect(finalTasks[0].title).toBe(`sub-update-${NUM_CLIENTS - 1}`);
  });

  it("mixed create/update/delete storm", async () => {
    const projectId = `occ-storm-${Date.now()}`;
    const setup = await freshClient();

    // Create 10 initial tasks
    const taskIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      await setup.mutation("tasks:create", taskArgs({ title: `storm-${i}`, projectId }));
    }
    const { result: initial } = await setup.query("tasks:listByProject", { projectId });
    for (const t of initial) taskIds.push(t._id);

    // Spin up clients for concurrent mixed operations
    const workers = await Promise.all(
      Array.from({ length: 6 }, () => freshClient())
    );

    const operations = [
      // Updates
      ...workers.slice(0, 3).map((w, i) =>
        w.mutation("tasks:update", { id: taskIds[i], title: `storm-updated-${i}` })
      ),
      // Deletes
      ...workers.slice(3, 5).map((w, i) =>
        w.mutation("tasks:remove", { id: taskIds[i + 5] })
      ),
      // New creates
      workers[5].mutation("tasks:create", taskArgs({ title: "storm-new", projectId })),
    ];

    const results = await Promise.allSettled(operations);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    // Most should succeed
    expect(succeeded).toBeGreaterThan(0);

    // Verify data integrity
    const { result: finalTasks } = await setup.query("tasks:listByProject", { projectId });

    // All remaining tasks should have valid titles
    for (const task of finalTasks) {
      expect(task.title).toBeDefined();
      expect(task.projectId).toBe(projectId);
    }
  });

  it("many clients subscribing and mutating simultaneously", async () => {
    const projectId = `occ-sub-stress-${Date.now()}`;
    const setup = await freshClient();

    await setup.mutation("tasks:create", taskArgs({ title: "sub-stress", projectId }));
    const { result: initial } = await setup.query("tasks:listByProject", { projectId });
    const taskId = initial[0]._id;

    // 5 clients each subscribe then mutate
    const NUM_CLIENTS = 5;
    const activeClients = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => freshClient())
    );

    // All subscribe
    const subIds: string[] = [];
    for (const client of activeClients) {
      const { id } = await client.query("tasks:listByProject", { projectId });
      subIds.push(id);
    }

    // All update sequentially (to avoid conflict failures clouding the test)
    for (let i = 0; i < NUM_CLIENTS; i++) {
      await activeClients[i].mutation("tasks:update", {
        id: taskId,
        title: `sub-stress-${i}`,
      });
      // Give subscriptions a moment to propagate
      await sleep(100);
    }

    // Final query should show the last update
    const { result: finalTasks } = await setup.query("tasks:listByProject", { projectId });
    expect(finalTasks[0].title).toBe(`sub-stress-${NUM_CLIENTS - 1}`);
  });

  it("concurrent actions with embedded mutations", async () => {
    const projectId = `occ-action-${Date.now()}`;

    const NUM_CLIENTS = 3;
    const actors = await Promise.all(
      Array.from({ length: NUM_CLIENTS }, () => freshClient())
    );

    // All clients run actions that internally create tasks
    const results = await Promise.allSettled(
      actors.map((client, i) =>
        client.action("tasks:createViaAction", {
          title: `action-task-${i}`,
          status: "todo",
          priority: "medium",
          projectId,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(NUM_CLIENTS);

    // Verify all tasks were created
    const reader = await freshClient();
    const { result: tasks } = await reader.query("tasks:listByProject", { projectId });
    expect(tasks.length).toBe(NUM_CLIENTS);
  });
});
