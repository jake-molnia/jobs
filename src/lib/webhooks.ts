import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { logger } from "./logger";
import { statusSchema, type Entry } from "./records";
import {
  applicationEventSchema,
  eventTypeSchema,
  webhookInputSchema,
  webhookPatchSchema,
  webhookHistoryQuerySchema,
  webhookDeliveryQuerySchema,
  webhookDeliverySchema,
} from "./webhook-schemas";
export {
  eventTypeSchema,
  webhookInputSchema,
  webhookPatchSchema,
  webhookHistoryQuerySchema,
  webhookDeliveryQuerySchema,
} from "./webhook-schemas";

function destinationAllowed(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const origins = (process.env.WEBHOOK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return (
    !url.username &&
    !url.password &&
    !url.hash &&
    origins.includes(url.origin) &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        local &&
        process.env.NODE_ENV !== "production"))
  );
}

const destinationSchema = z.url().max(2048).refine(destinationAllowed, {
  message:
    "Use an HTTPS URL whose exact origin is in WEBHOOK_ALLOWED_ORIGINS. Local HTTP is allowed only outside production. Credentials and fragments are not allowed.",
});
const subscriptionRowSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.string(),
  statuses: z.string(),
  enabled: z.number(),
  secret: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
function decodeSubscription(row: unknown) {
  const stored = subscriptionRowSchema.parse(row);
  return {
    id: stored.id,
    url: stored.url,
    events: z.array(eventTypeSchema).parse(JSON.parse(stored.events)),
    statuses: z.array(statusSchema).parse(JSON.parse(stored.statuses)),
    enabled: stored.enabled === 1,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}
const claimedSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  subscriptionId: z.string(),
  attempts: z.number(),
  leaseToken: z.string(),
});
const dispatchRowSchema = z.object({
  url: z.string(),
  secret: z.string(),
  body: z.string(),
  type: eventTypeSchema,
});
const maximumAttempts = 8;

export function initializeWebhooks(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_events (
      id TEXT PRIMARY KEY, recordId TEXT NOT NULL, type TEXT NOT NULL,
      timestamp TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
    );
    CREATE INDEX IF NOT EXISTS application_events_record ON application_events(recordId, timestamp DESC);
    CREATE INDEX IF NOT EXISTS application_events_time ON application_events(timestamp DESC);
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL, statuses TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), secret TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, eventId TEXT NOT NULL REFERENCES application_events(id),
      subscriptionId TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('pending', 'inflight', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL,
      leaseUntil INTEGER, leaseToken TEXT, lastStatus INTEGER, lastError TEXT,
      createdAt TEXT NOT NULL, completedAt TEXT,
      UNIQUE(eventId, subscriptionId)
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries(state, nextAttemptAt);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription ON webhook_deliveries(subscriptionId, createdAt DESC);
  `);
}

export function enqueueRecordEvent(
  db: DatabaseSync,
  { previous, current }: { previous: Entry | null; current: Entry },
) {
  const previousFields = new Map(Object.entries(previous ?? {}));
  const changedFields = Object.entries(current)
    .filter(
      ([key, value]) =>
        !["id", "createdAt", "updatedAt"].includes(key) &&
        JSON.stringify(value) !== JSON.stringify(previousFields.get(key)),
    )
    .map(([key]) => key);
  if (previous && !changedFields.length) return null;
  const event = applicationEventSchema.parse({
    id: randomUUID(),
    version: 1,
    type: !previous
      ? "application.created"
      : previous.status !== current.status
        ? "application.status_changed"
        : "application.updated",
    timestamp: new Date().toISOString(),
    data: {
      record: current,
      previousStatus: previous?.status ?? null,
      changedFields,
    },
  });
  db.prepare(
    "INSERT INTO application_events (id, recordId, type, timestamp, body) VALUES (?, ?, ?, ?, ?)",
  ).run(
    event.id,
    current.id,
    event.type,
    event.timestamp,
    JSON.stringify(event),
  );
  for (const row of db
    .prepare("SELECT * FROM webhook_subscriptions WHERE enabled = 1")
    .all()) {
    const subscription = decodeSubscription(row);
    if (
      !subscription.events.includes(event.type) ||
      (subscription.statuses.length > 0 &&
        !subscription.statuses.includes(current.status))
    )
      continue;
    db.prepare(
      `INSERT INTO webhook_deliveries (id, eventId, subscriptionId, state, nextAttemptAt, createdAt)
      VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).run(randomUUID(), event.id, subscription.id, Date.now(), event.timestamp);
  }
  return event;
}

export function createWebhookStore(db: DatabaseSync) {
  const get = (id: string) => {
    const row = db
      .prepare("SELECT * FROM webhook_subscriptions WHERE id = ?")
      .get(id);
    return row ? decodeSubscription(row) : null;
  };
  return {
    get,
    list() {
      return db
        .prepare(
          "SELECT * FROM webhook_subscriptions ORDER BY createdAt DESC, id",
        )
        .all()
        .map(decodeSubscription);
    },
    create(raw: z.input<typeof webhookInputSchema>) {
      const input = webhookInputSchema.parse(raw);
      destinationSchema.parse(input.url);
      const id = randomUUID();
      const secret = randomBytes(32).toString("hex");
      const now = new Date().toISOString();
      const row = db
        .prepare(
          `INSERT INTO webhook_subscriptions (id, url, events, statuses, enabled, secret, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(
          id,
          input.url,
          JSON.stringify(input.events),
          JSON.stringify(input.statuses),
          Number(input.enabled),
          secret,
          now,
          now,
        );
      logger.info(
        { event: "webhook.created", subscriptionId: id },
        "Webhook created",
      );
      return { ...decodeSubscription(row), secret };
    },
    update(id: string, raw: z.input<typeof webhookPatchSchema>) {
      const patch = webhookPatchSchema.parse(raw);
      if (patch.url !== undefined) destinationSchema.parse(patch.url);
      const fields: string[] = ["updatedAt = ?"];
      const values: SQLInputValue[] = [new Date().toISOString()];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        fields.push(`${key} = ?`);
        values.push(
          Array.isArray(value)
            ? JSON.stringify(value)
            : typeof value === "boolean"
              ? Number(value)
              : value,
        );
      }
      const row = db
        .prepare(
          `UPDATE webhook_subscriptions SET ${fields.join(", ")} WHERE id = ? RETURNING *`,
        )
        .get(...values, id);
      return row ? decodeSubscription(row) : null;
    },
    delete(id: string) {
      return (
        db.prepare("DELETE FROM webhook_subscriptions WHERE id = ?").run(id)
          .changes > 0
      );
    },
    listEvents(raw: z.input<typeof webhookHistoryQuerySchema> = {}) {
      const query = webhookHistoryQuerySchema.parse(raw);
      const where = query.recordId ? "WHERE recordId = ?" : "";
      const values: SQLInputValue[] = query.recordId ? [query.recordId] : [];
      const events = db
        .prepare(
          `SELECT body FROM application_events ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, query.limit, query.offset)
        .map((row) =>
          applicationEventSchema.parse(
            JSON.parse(z.object({ body: z.string() }).parse(row).body),
          ),
        );
      const total = z
        .object({ count: z.number() })
        .parse(
          db
            .prepare(
              `SELECT count(*) AS count FROM application_events ${where}`,
            )
            .get(...values),
        ).count;
      return { events, total };
    },
    listDeliveries(raw: z.input<typeof webhookDeliveryQuerySchema> = {}) {
      const query = webhookDeliveryQuerySchema.parse(raw);
      const where = query.subscriptionId ? "WHERE subscriptionId = ?" : "";
      const values: SQLInputValue[] = query.subscriptionId
        ? [query.subscriptionId]
        : [];
      return db
        .prepare(
          `SELECT * FROM webhook_deliveries ${where} ORDER BY createdAt DESC, rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, query.limit, query.offset)
        .map((row) => webhookDeliverySchema.parse(row));
    },
    async dispatchDue({ limit = 20 }: { limit?: number } = {}) {
      let dispatched = 0;
      for (let index = 0; index < Math.min(Math.max(limit, 0), 100); index++) {
        const now = Date.now();
        db.prepare(
          `UPDATE webhook_deliveries SET state = 'failed', leaseUntil = NULL, leaseToken = NULL,
          lastError = 'lease_expired', completedAt = ? WHERE state = 'inflight' AND leaseUntil <= ? AND attempts >= ?`,
        ).run(new Date(now).toISOString(), now, maximumAttempts);
        const row = db
          .prepare(
            `UPDATE webhook_deliveries SET state = 'inflight', attempts = attempts + 1,
          leaseUntil = ?, leaseToken = ? WHERE id = (
            SELECT d.id FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id = d.subscriptionId
            WHERE s.enabled = 1 AND d.attempts < ? AND
              ((d.state = 'pending' AND d.nextAttemptAt <= ?) OR (d.state = 'inflight' AND d.leaseUntil <= ?))
            ORDER BY d.nextAttemptAt, d.rowid LIMIT 1
          ) RETURNING id, eventId, subscriptionId, attempts, leaseToken`,
          )
          .get(now + 30_000, randomUUID(), maximumAttempts, now, now);
        if (!row) break;
        const delivery = claimedSchema.parse(row);
        const dispatchRow = db
          .prepare(
            `SELECT s.url, s.secret, e.body, e.type FROM webhook_deliveries d
          JOIN webhook_subscriptions s ON s.id = d.subscriptionId JOIN application_events e ON e.id = d.eventId
          WHERE d.id = ?`,
          )
          .get(delivery.id);
        if (!dispatchRow) continue;
        const target = dispatchRowSchema.parse(dispatchRow);
        let status: number | null = null;
        let error: string | null = null;
        try {
          if (!destinationSchema.safeParse(target.url).success) {
            error = "destination_not_allowed";
          } else {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const signature = createHmac("sha256", target.secret)
              .update(`${timestamp}.${target.body}`)
              .digest("hex");
            const response = await fetch(target.url, {
              method: "POST",
              redirect: "manual",
              signal: AbortSignal.timeout(10_000),
              headers: {
                "content-type": "application/json",
                "x-webhook-id": delivery.id,
                "x-webhook-event-id": delivery.eventId,
                "x-webhook-event": target.type,
                "x-webhook-timestamp": timestamp,
                "x-webhook-signature": `sha256=${signature}`,
              },
              body: target.body,
            });
            status = response.status;
            await response.body?.cancel();
            if (!response.ok) error = `http_${status}`;
          }
        } catch (failure) {
          error =
            failure instanceof Error && failure.name === "TimeoutError"
              ? "timeout"
              : "network_error";
        }
        const succeeded = error === null;
        const terminal = succeeded || delivery.attempts >= maximumAttempts;
        const state = succeeded ? "succeeded" : terminal ? "failed" : "pending";
        const nextAttemptAt =
          Date.now() +
          Math.min(30_000 * 2 ** (delivery.attempts - 1), 3_600_000);
        db.prepare(
          `UPDATE webhook_deliveries SET state = ?, nextAttemptAt = ?, leaseUntil = NULL,
          leaseToken = NULL, lastStatus = ?, lastError = ?, completedAt = ? WHERE id = ? AND leaseToken = ?`,
        ).run(
          state,
          nextAttemptAt,
          status,
          error,
          terminal ? new Date().toISOString() : null,
          delivery.id,
          delivery.leaseToken,
        );
        logger[succeeded ? "info" : "warn"](
          {
            event: "webhook.delivery",
            deliveryId: delivery.id,
            eventId: delivery.eventId,
            subscriptionId: delivery.subscriptionId,
            attempt: delivery.attempts,
            state,
            status,
            error,
          },
          succeeded ? "Webhook delivered" : "Webhook delivery failed",
        );
        dispatched++;
      }
      return { dispatched };
    },
  };
}
