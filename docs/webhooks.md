# Webhooks

Webhooks send application changes to an HTTP endpoint you control. All subscription, event-list, and delivery-list management endpoints require the same bearer `WRITE_TOKEN` as record writes. The record-specific history endpoint remains public alongside the dashboard.

## Register a destination

Set the allowed origins on the dashboard process and restart it. Origins include the scheme, host, and optional port, with no path or trailing slash.

```dotenv
WEBHOOK_ALLOWED_ORIGINS=https://automation.example.com,https://hooks.example.com
```

Destinations must use HTTPS and an exact allowlisted origin. During local development, an explicitly allowlisted `http://localhost:<port>` or loopback IP origin is also accepted. Production requires HTTPS. Credentials and fragments in destination URLs are rejected. Redirects are never followed, and the worker checks the allowlist again before each delivery.

```sh
curl http://localhost:3000/api/webhooks \
  -H "Authorization: Bearer $WRITE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://automation.example.com/hooks/index","events":["application.status_changed"],"statuses":["applied","interview","offer"]}'
```

The response includes a generated `id` and `secret`. Store the secret in the receiving app. Only the creation response includes it; subsequent reads omit it. If it is lost, create a replacement subscription and delete the old one.

| Endpoint                       | Response or action                                                             |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `GET /api/webhooks`            | `{ "subscriptions": [...] }`, secrets omitted                                  |
| `POST /api/webhooks`           | Created subscription including its one-time secret                             |
| `GET /api/webhooks/:id`        | One subscription, secret omitted                                               |
| `PATCH /api/webhooks/:id`      | Change URL, event filters, status filters, or enabled flag                     |
| `DELETE /api/webhooks/:id`     | Delete the subscription and its delivery records                               |
| `GET /api/webhooks/events`     | `{ "events": [...], "total": number }`; optional `recordId`, `limit`, `offset` |
| `GET /api/webhooks/deliveries` | `{ "deliveries": [...] }`; optional `subscriptionId`, `limit`, `offset`        |
| `GET /api/records/:id/events`  | Public event history for one record                                            |

Omitted `events` selects all event types, `statuses` defaults to an empty array meaning any status, and `enabled` defaults to `true`. A status filter matches the record's resulting status. For example, an `application.status_changed` subscription with `statuses: ["interview"]` fires when a record enters interview.

## Events

Each write produces at most one event. A new record emits `application.created`. A changed status emits `application.status_changed`. Other changed fields emit `application.updated`. An unchanged upsert or patch emits nothing. The database saves the record, immutable event snapshot, and matching queued deliveries in one transaction. Organization profile changes and database migrations do not emit application events.

```json
{
  "id": "a6ca9a47-c389-4dd2-b96b-1cc14daf126d",
  "version": 1,
  "type": "application.status_changed",
  "timestamp": "2026-09-21T12:00:00.000Z",
  "data": {
    "record": "The complete record object described in data.md",
    "previousStatus": "saved",
    "changedFields": ["status", "appliedAt"]
  }
}
```

The `record` value above is abbreviated for readability; the actual payload contains the complete record object, including metadata and notes. `previousStatus` is `null` for creation. `changedFields` excludes the record ID and timestamps. A change in organization includes `organizationId`. New subscriptions receive future matching events, with no automatic historical replay. Changing filters does not rewrite existing queued deliveries.

## Verify a delivery

| Header                | Value                                            |
| --------------------- | ------------------------------------------------ |
| `X-Webhook-Id`        | Delivery UUID, stable across retries             |
| `X-Webhook-Event-Id`  | Event UUID                                       |
| `X-Webhook-Event`     | Event type                                       |
| `X-Webhook-Timestamp` | Unix timestamp in seconds for this attempt       |
| `X-Webhook-Signature` | `sha256=` followed by the HMAC-SHA256 hex digest |

The signed message is the timestamp, a literal period, and the raw request body: `${timestamp}.${rawBody}`. Use the secret exactly as returned, as a UTF-8 string. Do not hex-decode it. Verify the raw bytes before parsing JSON, reject stale timestamps, and compare signatures in constant time.

This Node.js helper verifies a signature with a five-minute timestamp tolerance. Call it with the untouched raw request body and the receiver's stored secret.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook({ rawBody, timestamp, signature, secret }) {
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  if (Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;

  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature.slice(7), "hex");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
```

After verification, parse the body and deduplicate using its event `id`, or the delivery ID if the receiver intentionally handles several subscriptions separately. Persist that ID alongside the receiver's work. Return a 2xx response after accepting the event. The event ID also appears inside the signed body, so it can be used without trusting unsigned headers.

## Delivery and monitoring

The app checks its durable queue every five seconds while its Node.js process is running. Each batch attempts up to 20 deliveries with at most four requests running concurrently. A subscription has at most one unexpired delivery lease at a time, so its backlog cannot occupy every request slot. Deliveries are claimed only when a slot is ready. After ten seconds, a batch stops claiming work and waits for its current requests to finish, leaving the remaining queue for the next poll. This lets newly queued subscriptions run without waiting for an entire slow backlog. Delivery requests time out after ten seconds. Non-2xx responses and network failures retry with exponential delays starting at 30 seconds and capped at one hour. A delivery stops after eight attempts and becomes `failed`. Response bodies are discarded.

A 30-second lease lets the worker recover deliveries after a crash. Delivery is at least once; a receiver can see duplicates if it accepts an event just before the sender crashes. Processing order is not guaranteed across retries. The payload's immutable event timestamp helps a receiver avoid overwriting newer state with an older event. Retry attempts retain event and delivery IDs but receive a new signing timestamp and signature. For automations that need current state rather than a historical transition, read `GET /api/records/:id` before acting.

Set `enabled: false` to pause a subscription's pending deliveries. While disabled, it does not queue new events. Re-enabling resumes previously pending deliveries. Updating a subscription's URL sends pending deliveries to the new URL. Deleting a subscription removes its delivery records; immutable application events remain. A request already in flight may finish after a subscription is paused, changed, or deleted.

Read delivery `state`, `attempts`, `lastStatus`, and `lastError` through the API or `list_webhook_deliveries` MCP tool. `nextAttemptAt` and `leaseUntil` are Unix milliseconds; `createdAt` and `completedAt` are ISO timestamps. Logs include delivery IDs and outcomes without URLs, secrets, or payloads. Event and delivery history has no automatic expiry, so include it in database capacity planning and backups. There is no manual replay endpoint in this version.
