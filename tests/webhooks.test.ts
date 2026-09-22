import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordSchema, type Entry } from "../src/lib/records";
import {
  createWebhookStore,
  enqueueRecordEvent,
  initializeWebhooks,
} from "../src/lib/webhooks";

let db: DatabaseSync;
let store: ReturnType<typeof createWebhookStore>;
let receiver: Server;
let destination: string;
let responseStatus = 204;
let beforeResponse: (path: string) => Promise<void>;
let received: {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  path: string;
}[];
function entry(overrides: Partial<Entry> = {}): Entry {
  return recordSchema.parse({
    id: randomUUID(),
    organizationId: randomUUID(),
    title: "Research engineer",
    organization: "Institute",
    url: "https://example.org/role",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });
}
function enqueue(previous: Entry | null, current: Entry) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const event = enqueueRecordEvent(db, { previous, current });
    db.exec("COMMIT");
    return event;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initializeWebhooks(db);
  store = createWebhookStore(db);
  responseStatus = 204;
  beforeResponse = async () => {};
  received = [];
  receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    received.push({
      body: Buffer.concat(chunks).toString(),
      headers: request.headers,
      path: request.url ?? "",
    });
    await beforeResponse(request.url ?? "");
    response.writeHead(
      responseStatus,
      responseStatus === 302
        ? { location: `${destination}/redirected` }
        : undefined,
    );
    response.end();
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  const address = receiver.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a TCP listener");
  destination = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("WEBHOOK_ALLOWED_ORIGINS", destination);
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    receiver.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
  vi.unstubAllEnvs();
});

describe("durable webhook delivery", () => {
  it("signs the exact stored event body and exposes the secret only at creation", async () => {
    const subscription = store.create({ url: `${destination}/receive` });
    const record = entry();
    const event = enqueue(null, record);
    expect(event?.type).toBe("application.created");
    expect(store.get(subscription.id)).not.toHaveProperty("secret");
    expect(store.list()[0]).not.toHaveProperty("secret");
    expect(store.update(subscription.id, { enabled: true })).not.toHaveProperty(
      "secret",
    );
    expect(await store.dispatchDue()).toEqual({ dispatched: 1 });
    expect(received).toHaveLength(1);
    const request = received[0];
    expect(JSON.parse(request.body)).toEqual(event);
    const signature = createHmac("sha256", subscription.secret)
      .update(`${request.headers["x-webhook-timestamp"]}.${request.body}`)
      .digest("hex");
    expect(request.headers["x-webhook-signature"]).toBe(`sha256=${signature}`);
    expect(request.headers["x-webhook-event-id"]).toBe(event?.id);
    expect(request.headers["x-webhook-event"]).toBe("application.created");
    expect(request.headers["x-webhook-id"]).toBe(store.listDeliveries()[0].id);
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "succeeded",
      attempts: 1,
      lastStatus: 204,
      lastError: null,
    });
  });

  it("delivers to a healthy subscription while a slow backlog holds one lease", async () => {
    const slow = store.create({ url: `${destination}/slow` });
    for (let index = 0; index < 6; index++) enqueue(null, entry());
    const healthy = store.create({ url: `${destination}/healthy` });
    enqueue(null, entry());
    const gate = Promise.withResolvers<void>();
    beforeResponse = (path) =>
      path === "/slow" ? gate.promise : Promise.resolve();
    const dispatch = store.dispatchDue();
    try {
      await vi.waitFor(() => {
        expect(store.listDeliveries({ subscriptionId: healthy.id })[0]).toMatchObject({
          state: "succeeded",
          attempts: 1,
        });
      });
      expect(received.filter((item) => item.path === "/slow")).toHaveLength(1);
      expect(store.listDeliveries({ subscriptionId: slow.id }).filter(
        (item) => item.state === "inflight",
      )).toHaveLength(1);
      expect(await createWebhookStore(db).dispatchDue()).toEqual({ dispatched: 0 });
      store.update(slow.id, { enabled: false });
    } finally {
      gate.resolve();
      await dispatch;
    }
    expect(received.filter((item) => item.path === "/slow")).toHaveLength(1);
    expect(store.listDeliveries({ subscriptionId: slow.id }).filter(
      (item) => item.state === "pending" && item.attempts === 0,
    )).toHaveLength(6);
  });

  it("yields a slow backlog after the claim window so the next poll can serve new subscriptions", async () => {
    store.create({ url: `${destination}/slow` });
    for (let index = 0; index < 6; index++) enqueue(null, entry());
    const gate = Promise.withResolvers<void>();
    beforeResponse = () => gate.promise;
    const dispatch = store.dispatchDue();
    try {
      await vi.waitFor(() => expect(received).toHaveLength(1));
      const healthy = store.create({ url: `${destination}/healthy` });
      enqueue(null, entry());
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
      try {
        gate.resolve();
        expect(await dispatch).toEqual({ dispatched: 1 });
      } finally {
        now.mockRestore();
      }
      expect(store.listDeliveries({ subscriptionId: healthy.id })[0].attempts).toBe(0);
      await store.dispatchDue();
      expect(store.listDeliveries({ subscriptionId: healthy.id })[0].state).toBe("succeeded");
    } finally {
      gate.resolve();
      await dispatch;
    }
  });

  it("caps concurrent requests at four and claims only the bounded batch", async () => {
    for (let index = 0; index < 8; index++) {
      store.create({ url: `${destination}/receiver-${index}` });
    }
    enqueue(null, entry());
    const gate = Promise.withResolvers<void>();
    let active = 0;
    let peak = 0;
    beforeResponse = async () => {
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
    };
    const dispatch = store.dispatchDue({ limit: 6 });
    try {
      await vi.waitFor(() => expect(received).toHaveLength(4));
      expect(store.listDeliveries().filter((item) => item.state === "inflight")).toHaveLength(4);
      expect(store.listDeliveries().filter((item) => item.attempts === 0)).toHaveLength(4);
    } finally {
      gate.resolve();
      await dispatch;
    }
    expect(await dispatch).toEqual({ dispatched: 6 });
    expect(peak).toBe(4);
    expect(received).toHaveLength(6);
    expect(store.listDeliveries().filter((item) => item.attempts === 0)).toHaveLength(2);
  });

  it("stores one status event, filters on destination status, and suppresses no-op writes", () => {
    store.create({
      url: destination,
      events: ["application.status_changed"],
      statuses: ["offer"],
    });
    const first = entry();
    enqueue(null, first);
    const applied: Entry = { ...first, status: "applied" };
    enqueue(first, applied);
    const offered: Entry = {
      ...applied,
      status: "offer",
      nextAction: "Respond",
    };
    const event = enqueue(applied, offered);
    expect(event).toMatchObject({
      type: "application.status_changed",
      data: {
        previousStatus: "applied",
        changedFields: ["status", "nextAction"],
      },
    });
    expect(
      enqueue(offered, {
        ...offered,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    ).toBeNull();
    expect(store.listEvents({ recordId: first.id }).total).toBe(3);
    expect(store.listDeliveries()).toHaveLength(1);
    expect(store.listDeliveries()[0].eventId).toBe(event?.id);
  });

  it("persists updates, paginates history, and rolls events and deliveries back with the mutation", () => {
    store.create({ url: destination });
    const record = entry();
    enqueue(null, record);
    enqueue(record, { ...record, notes: "Follow up" });
    expect(store.listEvents({ limit: 1 })).toMatchObject({
      total: 2,
      events: [{ type: "application.updated" }],
    });
    expect(store.listEvents({ offset: 1 }).events[0].type).toBe(
      "application.created",
    );
    db.exec("BEGIN IMMEDIATE");
    enqueueRecordEvent(db, {
      previous: record,
      current: { ...record, status: "closed" },
    });
    db.exec("ROLLBACK");
    expect(store.listEvents().total).toBe(2);
    expect(store.listDeliveries()).toHaveLength(2);
    initializeWebhooks(db);
    expect(createWebhookStore(db).listEvents().total).toBe(2);
  });

  it("retries a failed receiver on its schedule using stable event and delivery IDs", async () => {
    store.create({ url: destination });
    enqueue(null, entry());
    responseStatus = 503;
    await store.dispatchDue();
    const delivery = store.listDeliveries()[0];
    expect(delivery).toMatchObject({
      state: "pending",
      attempts: 1,
      lastStatus: 503,
      lastError: "http_503",
    });
    expect(delivery.nextAttemptAt).toBeGreaterThan(Date.now() + 25_000);
    expect(await store.dispatchDue()).toEqual({ dispatched: 0 });
    db.prepare(
      "UPDATE webhook_deliveries SET nextAttemptAt = 0 WHERE id = ?",
    ).run(delivery.id);
    responseStatus = 200;
    await createWebhookStore(db).dispatchDue();
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });
    expect(received[0].headers["x-webhook-id"]).toBe(
      received[1].headers["x-webhook-id"],
    );
    expect(received[0].body).toBe(received[1].body);
  });

  it("leases each delivery to one concurrent worker and reclaims expired leases", async () => {
    store.create({ url: destination });
    enqueue(null, entry());
    const outcomes = await Promise.all([
      store.dispatchDue(),
      createWebhookStore(db).dispatchDue(),
    ]);
    expect(outcomes.reduce((sum, item) => sum + item.dispatched, 0)).toBe(1);
    expect(received).toHaveLength(1);
    enqueue(null, entry());
    db.exec(
      "UPDATE webhook_deliveries SET state = 'inflight', leaseUntil = 0, leaseToken = 'abandoned', attempts = 1 WHERE state = 'pending'",
    );
    expect(await store.dispatchDue()).toEqual({ dispatched: 1 });
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "succeeded",
      attempts: 2,
    });
  });

  it("keeps the queue after reopening and claims once across separate SQLite connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "apply-webhook-durable-"));
    const path = join(directory, "queue.db");
    const initial = new DatabaseSync(path);
    initializeWebhooks(initial);
    createWebhookStore(initial).create({ url: destination });
    initial.exec("BEGIN IMMEDIATE");
    enqueueRecordEvent(initial, { previous: null, current: entry() });
    initial.exec("COMMIT");
    initial.close();
    const first = new DatabaseSync(path);
    const second = new DatabaseSync(path);
    try {
      const outcomes = await Promise.all([
        createWebhookStore(first).dispatchDue(),
        createWebhookStore(second).dispatchDue(),
      ]);
      expect(outcomes.reduce((sum, item) => sum + item.dispatched, 0)).toBe(1);
      expect(received).toHaveLength(1);
      expect(createWebhookStore(second).listDeliveries()[0]).toMatchObject({
        state: "succeeded",
        attempts: 1,
      });
    } finally {
      first.close();
      second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stops after eight failed attempts and finalizes an abandoned last attempt", async () => {
    store.create({ url: destination });
    enqueue(null, entry());
    responseStatus = 500;
    for (let attempt = 0; attempt < 8; attempt++) {
      db.exec("UPDATE webhook_deliveries SET nextAttemptAt = 0");
      await store.dispatchDue();
    }
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "failed",
      attempts: 8,
    });
    expect(await store.dispatchDue()).toEqual({ dispatched: 0 });
    enqueue(null, entry());
    db.exec(
      "UPDATE webhook_deliveries SET state = 'inflight', leaseUntil = 0, attempts = 8 WHERE state = 'pending'",
    );
    await store.dispatchDue();
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "failed",
      lastError: "lease_expired",
      attempts: 8,
    });
    expect(received).toHaveLength(8);
  });

  it("pauses deliveries when disabled and deletes their queue when unsubscribed", async () => {
    const subscription = store.create({ url: destination });
    enqueue(null, entry());
    store.update(subscription.id, { enabled: false });
    enqueue(null, entry());
    expect(await store.dispatchDue()).toEqual({ dispatched: 0 });
    expect(store.listDeliveries()).toHaveLength(1);
    store.update(subscription.id, { enabled: true });
    expect(await store.dispatchDue()).toEqual({ dispatched: 1 });
    expect(store.delete(subscription.id)).toBe(true);
    expect(store.listDeliveries()).toEqual([]);
    expect(store.listEvents().total).toBe(2);
  });

  it("requires an exact allowed origin and checks it again before sending", async () => {
    expect(() =>
      store.create({ url: "https://not-allowed.example/receive" }),
    ).toThrow();
    expect(() =>
      store.create({ url: destination.replace("//", "//user:pass@") }),
    ).toThrow();
    expect(() => store.create({ url: `${destination}/#fragment` })).toThrow();
    store.create({ url: destination });
    enqueue(null, entry());
    vi.stubEnv("WEBHOOK_ALLOWED_ORIGINS", "");
    await store.dispatchDue();
    expect(received).toHaveLength(0);
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "pending",
      lastError: "destination_not_allowed",
    });
    vi.stubEnv("WEBHOOK_ALLOWED_ORIGINS", destination);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => store.create({ url: destination })).toThrow();
  });

  it("does not follow redirects", async () => {
    store.create({ url: `${destination}/receive` });
    enqueue(null, entry());
    responseStatus = 302;
    await store.dispatchDue();
    expect(received.map((item) => item.path)).toEqual(["/receive"]);
    expect(store.listDeliveries()[0]).toMatchObject({
      state: "pending",
      lastError: "http_302",
    });
  });
});
