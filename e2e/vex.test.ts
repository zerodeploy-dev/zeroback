import { describe, it, expect, afterEach } from "vitest";
import { VexTestClient, sleep } from "./harness";

let client: VexTestClient;

afterEach(() => {
  client?.close();
});

async function freshClient(): Promise<VexTestClient> {
  const c = new VexTestClient();
  client = c;
  await c.connect();
  return c;
}

/**
 * Wait briefly and assert no subscription update arrives.
 * Does NOT create a hanging timer — uses a short polling loop.
 */
async function expectNoUpdate(c: VexTestClient, subId: string, waitMs = 1000): Promise<void> {
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
    const result = await c.mutation("messages:send", {
      body: "hello",
      author: "alice",
      channel: "general",
    });
    expect(result).toBeUndefined();
  });

  it("should reject mutation with missing required args", async () => {
    const c = await freshClient();
    const err = await c.mutationError("messages:send", {
      body: "hello",
    });
    expect(err.code).toBe("execution_error");
    expect(err.message).toMatch(/Missing required field/);
  });

  it("should reject mutation with wrong arg type", async () => {
    const c = await freshClient();
    const err = await c.mutationError("messages:send", {
      body: 123,
      author: "alice",
      channel: "general",
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
    await c.mutation("messages:send", { body: "q-test-1", author: "bob", channel: "test-q" });
    await c.mutation("messages:send", { body: "q-test-2", author: "bob", channel: "test-q" });

    const { result } = await c.query("messages:list", { channel: "test-q" });
    expect(result).toHaveLength(2);
    expect(result.map((m: any) => m.body).sort()).toEqual(["q-test-1", "q-test-2"]);
  });

  it("should filter by channel via index — different channels return different results", async () => {
    const c = await freshClient();
    await c.mutation("messages:send", { body: "a1", author: "a", channel: "ch-a" });
    await c.mutation("messages:send", { body: "b1", author: "b", channel: "ch-b" });
    await c.mutation("messages:send", { body: "a2", author: "a", channel: "ch-a" });

    const { result: chA } = await c.query("messages:list", { channel: "ch-a" });
    const { result: chB } = await c.query("messages:list", { channel: "ch-b" });

    expect(chA.every((m: any) => m.channel === "ch-a")).toBe(true);
    expect(chB.every((m: any) => m.channel === "ch-b")).toBe(true);
    expect(chA).toHaveLength(2);
    expect(chB).toHaveLength(1);
  });

  it("should return empty array for nonexistent channel", async () => {
    const c = await freshClient();
    const { result } = await c.query("messages:list", { channel: "does-not-exist-xyz" });
    expect(result).toEqual([]);
  });

  it("should include _id and _creationTime on returned documents", async () => {
    const c = await freshClient();
    await c.mutation("messages:send", { body: "meta-test", author: "x", channel: "meta-ch" });
    const { result } = await c.query("messages:list", { channel: "meta-ch" });
    expect(result).toHaveLength(1);
    const doc = result[0];
    expect(doc._id).toMatch(/^messages\//);
    expect(typeof doc._creationTime).toBe("number");
    expect(doc._creationTime).toBeGreaterThan(0);
  });

  it("should respect order(desc) — newest first", async () => {
    const c = await freshClient();
    await c.mutation("messages:send", { body: "first", author: "a", channel: "order-ch" });
    await sleep(10);
    await c.mutation("messages:send", { body: "second", author: "a", channel: "order-ch" });

    const { result } = await c.query("messages:list", { channel: "order-ch" });
    expect(result[0].body).toBe("second");
    expect(result[1].body).toBe("first");
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
    const ch = "pag-ch-" + Date.now();

    for (let i = 0; i < 5; i++) {
      await c.mutation("messages:send", { body: `pag-${i}`, author: "a", channel: ch });
    }

    // Page 1
    const { result: page1 } = await c.query("messages:listPaginated", { channel: ch, numItems: 2 });
    expect(page1.page).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeTruthy();

    // Page 2
    const { result: page2 } = await c.query("messages:listPaginated", {
      channel: ch, numItems: 2, cursor: page1.continueCursor,
    });
    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(false);

    // Page 3 — last
    const { result: page3 } = await c.query("messages:listPaginated", {
      channel: ch, numItems: 2, cursor: page2.continueCursor,
    });
    expect(page3.page).toHaveLength(1);
    expect(page3.isDone).toBe(true);
    expect(page3.continueCursor).toBeNull();
  });

  it("should return all results when numItems exceeds total", async () => {
    const c = await freshClient();
    const ch = "pag-all-" + Date.now();
    await c.mutation("messages:send", { body: "one", author: "a", channel: ch });
    await c.mutation("messages:send", { body: "two", author: "a", channel: ch });

    const { result } = await c.query("messages:listPaginated", { channel: ch, numItems: 100 });
    expect(result.page).toHaveLength(2);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real-time subscriptions
// ---------------------------------------------------------------------------
describe("subscriptions", () => {
  it("should push update when a new message is inserted into the subscribed channel", async () => {
    const c = await freshClient();
    const ch = "sub-ch-" + Date.now();

    const { id: subId, result: initial } = await c.query("messages:list", { channel: ch });
    expect(initial).toEqual([]);

    const updatePromise = c.waitForUpdate(subId);
    await c.mutation("messages:send", { body: "live!", author: "z", channel: ch });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("live!");
  });

  it("should NOT push update for a different channel", async () => {
    const c = await freshClient();
    const ch1 = "sub-iso-1-" + Date.now();
    const ch2 = "sub-iso-2-" + Date.now();

    const { id: subId } = await c.query("messages:list", { channel: ch1 });

    // Insert into a different channel
    await c.mutation("messages:send", { body: "wrong-channel", author: "z", channel: ch2 });

    await expectNoUpdate(c, subId);
  });

  it("should push multiple sequential updates", async () => {
    const c = await freshClient();
    const ch = "sub-multi-" + Date.now();

    const { id: subId } = await c.query("messages:list", { channel: ch });

    const p1 = c.waitForUpdate(subId);
    await c.mutation("messages:send", { body: "msg-1", author: "a", channel: ch });
    const r1 = await p1;
    expect(r1).toHaveLength(1);

    const p2 = c.waitForUpdate(subId);
    await c.mutation("messages:send", { body: "msg-2", author: "b", channel: ch });
    const r2 = await p2;
    expect(r2).toHaveLength(2);
  });

  it("should stop receiving updates after unsubscribe", async () => {
    const c = await freshClient();
    const ch = "sub-unsub-" + Date.now();

    const { id: subId } = await c.query("messages:list", { channel: ch });

    // Verify subscription works
    const p1 = c.waitForUpdate(subId);
    await c.mutation("messages:send", { body: "before", author: "a", channel: ch });
    await p1;

    // Unsubscribe
    c.unsubscribe(subId);
    await sleep(200);

    // Insert another message — should NOT trigger update
    await c.mutation("messages:send", { body: "after", author: "a", channel: ch });
    await expectNoUpdate(c, subId);
  });
});

// ---------------------------------------------------------------------------
// Multiple clients
// ---------------------------------------------------------------------------
describe("multiple clients", () => {
  let client2: VexTestClient;

  afterEach(() => {
    client2?.close();
  });

  it("client2 should see mutations from client1 via subscription", async () => {
    const c1 = await freshClient();
    client2 = new VexTestClient();
    await client2.connect();

    const ch = "multi-ch-" + Date.now();

    const { id: subId } = await client2.query("messages:list", { channel: ch });

    const updatePromise = client2.waitForUpdate(subId);
    await c1.mutation("messages:send", { body: "from-c1", author: "c1", channel: ch });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("from-c1");
    expect(updated[0].author).toBe("c1");
  });

  it("both clients can query independently", async () => {
    const c1 = await freshClient();
    client2 = new VexTestClient();
    await client2.connect();

    const ch = "multi-q-" + Date.now();
    await c1.mutation("messages:send", { body: "shared", author: "a", channel: ch });

    const { result: r1 } = await c1.query("messages:list", { channel: ch });
    const { result: r2 } = await client2.query("messages:list", { channel: ch });

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
    const err = await c.mutationError("messages:send", {
      body: 42,
      author: "a",
      channel: "val-ch",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should reject boolean where string expected", async () => {
    const c = await freshClient();
    const err = await c.mutationError("messages:send", {
      body: true,
      author: "a",
      channel: "val-ch",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should reject null where string expected", async () => {
    const c = await freshClient();
    const err = await c.mutationError("messages:send", {
      body: null,
      author: "a",
      channel: "val-ch",
    });
    expect(err.message).toMatch(/Expected string/);
  });

  it("should accept optional args as undefined", async () => {
    const c = await freshClient();
    const ch = "opt-ch-" + Date.now();
    await c.mutation("messages:send", { body: "x", author: "a", channel: ch });

    // listPaginated has optional cursor and numItems
    const { result } = await c.query("messages:listPaginated", { channel: ch });
    expect(result.page).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------
describe("document structure", () => {
  it("each document should have a unique _id", async () => {
    const c = await freshClient();
    const ch = "unique-id-" + Date.now();
    await c.mutation("messages:send", { body: "a", author: "a", channel: ch });
    await c.mutation("messages:send", { body: "b", author: "a", channel: ch });

    const { result } = await c.query("messages:list", { channel: ch });
    const ids = result.map((m: any) => m._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("_id should be prefixed with table name", async () => {
    const c = await freshClient();
    const ch = "prefix-" + Date.now();
    await c.mutation("messages:send", { body: "x", author: "a", channel: ch });

    const { result } = await c.query("messages:list", { channel: ch });
    expect(result[0]._id).toMatch(/^messages\//);
  });

  it("_creationTime should be monotonically increasing", async () => {
    const c = await freshClient();
    const ch = "mono-" + Date.now();
    await c.mutation("messages:send", { body: "first", author: "a", channel: ch });
    await sleep(5);
    await c.mutation("messages:send", { body: "second", author: "a", channel: ch });

    const { result } = await c.query("messages:list", { channel: ch });
    // order("desc") so newest first
    expect(result[0]._creationTime).toBeGreaterThanOrEqual(result[1]._creationTime);
  });

  it("documents should preserve all user-supplied fields", async () => {
    const c = await freshClient();
    const ch = "fields-" + Date.now();
    await c.mutation("messages:send", { body: "hello world", author: "bob", channel: ch });

    const { result } = await c.query("messages:list", { channel: ch });
    expect(result[0]).toMatchObject({ body: "hello world", author: "bob", channel: ch });
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
describe("actions", () => {
  it("should run an action that calls runMutation and runQuery", async () => {
    const c = await freshClient();
    const ch = "action-ch-" + Date.now();
    const result = await c.action("messages:sendViaAction", {
      body: "from action",
      author: "bot",
      channel: ch,
    });
    expect(result.sent).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);

    // Verify the message was actually written
    const { result: messages } = await c.query("messages:list", { channel: ch });
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("from action");
  });

  it("action mutations should trigger subscription updates", async () => {
    const c = await freshClient();
    const ch = "action-sub-" + Date.now();

    // Subscribe first
    const { id: subId } = await c.query("messages:list", { channel: ch });

    // Send via action
    const updatePromise = c.waitForUpdate(subId);
    await c.action("messages:sendViaAction", {
      body: "action update",
      author: "bot",
      channel: ch,
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("action update");
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
describe("scheduler", () => {
  it("should schedule a mutation to run after a delay", async () => {
    const c = await freshClient();
    const ch = "sched-ch-" + Date.now();

    // Subscribe before scheduling
    const { id: subId, result: initial } = await c.query("messages:list", { channel: ch });
    expect(initial).toHaveLength(0);

    // Schedule a message to be sent after 100ms
    const jobId = await c.mutation("messages:scheduleSend", {
      body: "scheduled msg",
      author: "scheduler",
      channel: ch,
      delayMs: 100,
    });
    expect(typeof jobId).toBe("string");

    // Wait for the subscription update (triggered when scheduled job runs)
    const updated = await c.waitForUpdate(subId, 5000);
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("scheduled msg");
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
  it("POST /api/messages should insert a message via HTTP action", async () => {
    const ch = "http-action-" + Date.now();
    const res = await fetch("http://localhost:8788/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "via http", author: "curl", channel: ch }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify the message was actually persisted by querying via WS
    const c = await freshClient();
    const { result } = await c.query("messages:list", { channel: ch });
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("via http");
    expect(result[0].author).toBe("curl");
  });

  it("GET /api/messages should return messages via HTTP action", async () => {
    const ch = "http-get-" + Date.now();

    // Insert via WS first
    const c = await freshClient();
    await c.mutation("messages:send", { body: "msg1", author: "a", channel: ch });
    await c.mutation("messages:send", { body: "msg2", author: "b", channel: ch });

    // Read via HTTP
    const res = await fetch(`http://localhost:8788/api/messages?channel=${ch}`);
    expect(res.status).toBe(200);
    const messages = await res.json();
    expect(messages).toHaveLength(2);
  });

  it("HTTP action mutations should trigger WS subscription updates", async () => {
    const ch = "http-sub-" + Date.now();
    const c = await freshClient();

    // Subscribe via WS
    const { id: subId } = await c.query("messages:list", { channel: ch });

    // Insert via HTTP action
    const updatePromise = c.waitForUpdate(subId);
    await fetch("http://localhost:8788/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "http push", author: "api", channel: ch }),
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("http push");
  });
});

// ---------------------------------------------------------------------------
// Internal Functions
// ---------------------------------------------------------------------------

describe("internal functions", () => {
  it("rejects client calls to internalQuery", async () => {
    const c = await freshClient();
    const err = await c.queryError("messages:countMessages", { channel: "general" });
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("internal");
  });

  it("rejects client calls to internalMutation", async () => {
    const c = await freshClient();
    const err = await c.mutationError("messages:internalSend", {
      body: "test",
      author: "hacker",
      channel: "general",
    });
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("internal");
  });

  it("allows server-side code to call internal functions via action", async () => {
    const c = await freshClient();
    const ch = `internal-test-${Date.now()}`;

    // sendViaInternal is a public action that calls internalSend + countMessages
    const result = await c.action("messages:sendViaInternal", {
      body: "from action",
      author: "server",
      channel: ch,
    });

    expect(result.sent).toBe(true);
    expect(result.count).toBe(1);

    // Verify the message was actually created
    const { result: messages } = await c.query("messages:list", { channel: ch });
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("from action");
  });

  it("internal mutations trigger subscription updates", async () => {
    const c = await freshClient();
    const ch = `internal-sub-${Date.now()}`;

    // Subscribe to the channel
    const { id: subId } = await c.query("messages:list", { channel: ch });

    // Use the public action which calls the internal mutation
    const updatePromise = c.waitForUpdate(subId);
    await c.action("messages:sendViaInternal", {
      body: "internal push",
      author: "server",
      channel: ch,
    });

    const updated = await updatePromise;
    expect(updated).toHaveLength(1);
    expect(updated[0].body).toBe("internal push");
  });
});
