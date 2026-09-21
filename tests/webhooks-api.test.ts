import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as list, POST as create } from "../src/app/api/webhooks/route";
import {
  GET as get,
  PATCH as patch,
  DELETE as remove,
} from "../src/app/api/webhooks/[id]/route";
import { GET as events } from "../src/app/api/webhooks/events/route";
import { GET as deliveries } from "../src/app/api/webhooks/deliveries/route";
import { GET as timeline } from "../src/app/api/records/[id]/events/route";
import { getStore } from "../src/lib/db";
import { recordInputSchema } from "../src/lib/records";
import { webhookCreatedSchema } from "../src/lib/webhook-schemas";

const directory = mkdtempSync(join(tmpdir(), "apply-webhook-api-"));
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(
  path: string,
  method = "GET",
  body?: unknown,
  token = "test-token",
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(() => vi.stubEnv("DATABASE_PATH", join(directory, "records.db")));
beforeEach(() => {
  vi.stubEnv("WRITE_TOKEN", "test-token");
  vi.stubEnv("WEBHOOK_ALLOWED_ORIGINS", "https://integration.example");
});
afterAll(() => {
  getStore().close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("webhook management API", () => {
  it("requires write credentials for all management and queue endpoints", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const invalid = request("/api/webhooks", "GET", undefined, "wrong");
    for (const handler of [list, events, deliveries])
      expect((await handler(invalid)).status).toBe(401);
    expect((await get(invalid, context(id))).status).toBe(401);
    expect(
      (
        await patch(
          request(`/api/webhooks/${id}`, "PATCH", { enabled: false }, "wrong"),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await remove(
          request(`/api/webhooks/${id}`, "DELETE", undefined, "wrong"),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await create(
          request(
            "/api/webhooks",
            "POST",
            { url: "https://integration.example/hook" },
            "wrong",
          ),
        )
      ).status,
    ).toBe(401);
    vi.stubEnv("WRITE_TOKEN", "");
    expect((await list(request("/api/webhooks"))).status).toBe(503);
  });

  it("creates and manages redacted subscriptions and rejects invalid destinations", async () => {
    const response = await create(
      request("/api/webhooks", "POST", {
        url: "https://integration.example/hook",
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const subscription = webhookCreatedSchema.parse(await response.json());
    expect(
      await (
        await get(
          request(`/api/webhooks/${subscription.id}`),
          context(subscription.id),
        )
      ).json(),
    ).not.toHaveProperty("secret");
    expect(
      JSON.stringify(await (await list(request("/api/webhooks"))).json()),
    ).not.toContain(subscription.secret);
    const updated = await patch(
      request(`/api/webhooks/${subscription.id}`, "PATCH", { enabled: false }),
      context(subscription.id),
    );
    expect(await updated.json()).toMatchObject({
      enabled: false,
      events: [
        "application.created",
        "application.updated",
        "application.status_changed",
      ],
    });
    expect(
      (
        await create(
          request("/api/webhooks", "POST", {
            url: "https://unlisted.example/hook",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await create(request("/api/webhooks", "POST", { url: "invalid" })))
        .status,
    ).toBe(400);
    expect(
      (
        await patch(
          request(`/api/webhooks/${subscription.id}`, "PATCH", {}),
          context(subscription.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await remove(
          request(`/api/webhooks/${subscription.id}`, "DELETE"),
          context(subscription.id),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await get(
          request(`/api/webhooks/${subscription.id}`),
          context(subscription.id),
        )
      ).status,
    ).toBe(404);
  });

  it("records API and storage changes atomically with a public paginated timeline", async () => {
    const store = getStore();
    const subscription = store.webhooks.create({
      url: "https://integration.example/receive",
      events: ["application.status_changed"],
    });
    const record = store.upsert(
      recordInputSchema.parse({
        title: "Engineer",
        organization: "Example",
        url: "https://example.org/engineer",
      }),
    );
    store.update(record.id, { status: "applied" });
    store.update(record.id, { status: "applied" });
    const page = await timeline(
      request(`/api/records/${record.id}/events?limit=1`, "GET", undefined, ""),
      context(record.id),
    );
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({
      total: 2,
      events: [
        {
          type: "application.status_changed",
          data: { previousStatus: "saved", record: { status: "applied" } },
        },
      ],
    });
    expect(
      await (
        await events(
          request(`/api/webhooks/events?recordId=${record.id}&offset=1`),
        )
      ).json(),
    ).toMatchObject({ total: 2, events: [{ type: "application.created" }] });
    expect(
      await (
        await deliveries(
          request(`/api/webhooks/deliveries?subscriptionId=${subscription.id}`),
        )
      ).json(),
    ).toMatchObject({ deliveries: [{ state: "pending", attempts: 0 }] });
    expect(
      (
        await timeline(
          request(`/api/records/${record.id}/events?limit=101`),
          context(record.id),
        )
      ).status,
    ).toBe(400);
    const missingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      (
        await timeline(
          request(`/api/records/${missingId}/events`),
          context(missingId),
        )
      ).status,
    ).toBe(404);
  });
});
