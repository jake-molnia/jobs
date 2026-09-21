import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server";
import { recordInputSchema } from "../src/lib/records";
import { organizationInputSchema } from "../src/lib/organizations";

const silentLogger = pino({ level: "silent" });
const entry = {
  ...recordInputSchema.parse({
    title: "Research engineer",
    organization: "Example",
    url: "https://example.com/role",
  }),
  id: "3d96337f-ac29-4db1-8fbb-d96794708132",
  organizationId: "4d96337f-ac29-4db1-8fbb-d96794708132",
  createdAt: "2026-09-21T08:00:00.000Z",
  updatedAt: "2026-09-21T08:00:00.000Z",
};
const page = {
  records: [entry],
  total: 1,
  counts: { all: 1, saved: 1, applied: 0, interview: 0, offer: 0, closed: 0 },
};
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function connect(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  options: { timeoutMs?: number; writeToken?: string } = {},
) {
  const httpServer = createServer(handler);
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing test server address");
  cleanup.push(async () => {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const server = createMcpServer(
    { apiUrl: `http://127.0.0.1:${address.port}`, ...options },
    silentLogger,
  );
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function json(response: ServerResponse, payload: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

describe("MCP HTTP adapter", () => {
  it("starts the actual stdio entrypoint without contaminating the protocol", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "scripts/mcp.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    cleanup.push(async () => {
      await client.close();
    });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toContain(
      "list_organizations",
    );
    const invalid = await client.callTool({
      name: "get_record",
      arguments: { id: "invalid" },
    });
    expect(invalid.isError).toBe(true);
  });

  it("advertises record and organization tools and their write behavior", async () => {
    const client = await connect((_request, response) => json(response, page));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_records",
        "get_record",
        "upsert_record",
        "update_record",
        "list_organizations",
        "get_organization",
        "upsert_organization",
        "update_organization",
        "list_webhooks",
        "create_webhook",
        "update_webhook",
        "list_record_events",
        "list_webhook_deliveries",
      ]),
    );
    expect(
      tools.find((tool) => tool.name === "list_records")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "upsert_record")?.annotations
        ?.destructiveHint,
    ).toBe(true);
  });

  it("sends search filters and pagination, then reads the complete record", async () => {
    const requests: string[] = [];
    const client = await connect((request, response) => {
      requests.push(request.url ?? "");
      json(response, request.url?.includes(entry.id) ? entry : page);
    });
    const listed = await client.callTool({
      name: "list_records",
      arguments: {
        q: "research & design",
        status: "saved",
        kind: "role",
        organizationId: entry.organizationId,
        priority: "high",
        due: "follow_up",
        sort: "deadline",
        limit: 12,
        offset: 24,
      },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toEqual(page);
    const query = new URL(requests[0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      q: "research & design",
      status: "saved",
      kind: "role",
      organizationId: entry.organizationId,
      priority: "high",
      due: "follow_up",
      sort: "deadline",
      limit: "12",
      offset: "24",
    });
    const result = await client.callTool({
      name: "get_record",
      arguments: { id: entry.id },
    });
    expect(result.structuredContent).toEqual(entry);
    expect(requests[1]).toBe(`/api/records/${entry.id}`);
  });

  it("authenticates writes and only sends supplied patch fields", async () => {
    const requests: Array<{ method?: string; auth?: string; body: unknown }> =
      [];
    const client = await connect(
      (request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          requests.push({
            method: request.method,
            auth: request.headers.authorization,
            body: JSON.parse(body),
          });
          json(response, entry);
        });
      },
      { writeToken: "test-secret" },
    );
    const created = await client.callTool({
      name: "upsert_record",
      arguments: {
        title: entry.title,
        organization: entry.organization,
        url: entry.url,
      },
    });
    expect(created.isError).not.toBe(true);
    const updated = await client.callTool({
      name: "update_record",
      arguments: {
        id: entry.id,
        patch: { status: "applied", appliedAt: "2026-09-21" },
      },
    });
    expect(updated.isError).not.toBe(true);
    expect(requests[0]).toEqual({
      method: "POST",
      auth: "Bearer test-secret",
      body: recordInputSchema.parse({
        title: entry.title,
        organization: entry.organization,
        url: entry.url,
      }),
    });
    expect(requests[1]).toEqual({
      method: "PATCH",
      auth: "Bearer test-secret",
      body: { status: "applied", appliedAt: "2026-09-21" },
    });
  });

  it("reads the organization directory and sends only supplied profile patch fields", async () => {
    const organization = {
      ...organizationInputSchema.parse({ name: "Example" }),
      id: entry.organizationId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      counts: page.counts,
    };
    const requests: Array<{
      path: string;
      method: string | undefined;
      auth: string | undefined;
      body: unknown;
    }> = [];
    const client = await connect(
      (request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          requests.push({
            path: request.url ?? "",
            method: request.method,
            auth: request.headers.authorization,
            body: body ? JSON.parse(body) : null,
          });
          json(
            response,
            request.url?.startsWith("/api/organizations?")
              ? { organizations: [organization], total: 1 }
              : organization,
          );
        });
      },
      { writeToken: "profile-secret" },
    );
    const directory = await client.callTool({
      name: "list_organizations",
      arguments: { q: "Example", sort: "records" },
    });
    expect(directory.structuredContent).toEqual({
      organizations: [organization],
      total: 1,
    });
    const fetched = await client.callTool({
      name: "get_organization",
      arguments: { id: organization.id },
    });
    expect(fetched.structuredContent).toEqual(organization);
    const upserted = await client.callTool({
      name: "upsert_organization",
      arguments: { name: "Example", kind: "institute" },
    });
    expect(upserted.isError).not.toBe(true);
    expect(requests[2].body).toEqual(
      organizationInputSchema.parse({ name: "Example", kind: "institute" }),
    );
    const updated = await client.callTool({
      name: "update_organization",
      arguments: {
        id: organization.id,
        patch: { website: "https://example.com" },
      },
    });
    expect(updated.isError).not.toBe(true);
    expect(requests[3]).toEqual({
      path: `/api/organizations/${organization.id}`,
      method: "PATCH",
      auth: "Bearer profile-secret",
      body: { website: "https://example.com" },
    });
  });

  it("manages webhook subscriptions through the remote API without a local allowlist", async () => {
    const subscription = {
      id: "5d96337f-ac29-4db1-8fbb-d96794708132",
      url: "https://automation.example.com/hooks/applications",
      events: ["application.status_changed"],
      statuses: ["interview", "offer"],
      enabled: true,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    const requests: Array<{
      path: string;
      method: string | undefined;
      auth: string | undefined;
      body: unknown;
    }> = [];
    const client = await connect(
      (request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          requests.push({
            path: request.url ?? "",
            method: request.method,
            auth: request.headers.authorization,
            body: body ? JSON.parse(body) : null,
          });
          if (request.url?.startsWith("/api/webhooks/events"))
            return json(response, { events: [], total: 0 });
          if (request.url?.startsWith("/api/webhooks/deliveries"))
            return json(response, { deliveries: [] });
          if (request.method === "POST")
            return json(response, { ...subscription, secret: "a".repeat(64) });
          if (request.method === "PATCH")
            return json(response, { ...subscription, enabled: false });
          return json(response, { subscriptions: [subscription] });
        });
      },
      { writeToken: "webhook-secret" },
    );
    const created = await client.callTool({
      name: "create_webhook",
      arguments: {
        url: subscription.url,
        events: subscription.events,
        statuses: subscription.statuses,
      },
    });
    expect(created.structuredContent).toEqual({
      ...subscription,
      secret: "a".repeat(64),
    });
    expect(requests[0].body).toEqual({
      url: subscription.url,
      events: subscription.events,
      statuses: subscription.statuses,
      enabled: true,
    });
    const listed = await client.callTool({
      name: "list_webhooks",
      arguments: {},
    });
    expect(listed.structuredContent).toEqual({ subscriptions: [subscription] });
    expect(JSON.stringify(listed)).not.toContain("secret");
    const paused = await client.callTool({
      name: "update_webhook",
      arguments: { id: subscription.id, patch: { enabled: false } },
    });
    expect(paused.structuredContent).toEqual({
      ...subscription,
      enabled: false,
    });
    expect(requests[2].body).toEqual({ enabled: false });
    const events = await client.callTool({
      name: "list_record_events",
      arguments: { recordId: entry.id, limit: 10 },
    });
    expect(events.structuredContent).toEqual({ events: [], total: 0 });
    expect(requests[3].path).toBe(
      `/api/webhooks/events?recordId=${entry.id}&limit=10&offset=0`,
    );
    const deliveries = await client.callTool({
      name: "list_webhook_deliveries",
      arguments: { subscriptionId: subscription.id },
    });
    expect(deliveries.structuredContent).toEqual({ deliveries: [] });
    expect(requests[4].path).toContain(`subscriptionId=${subscription.id}`);
    expect(
      requests.every((request) => request.auth === "Bearer webhook-secret"),
    ).toBe(true);
  });

  it("rejects invalid tool input before contacting the API", async () => {
    let requests = 0;
    const client = await connect((_request, response) => {
      requests += 1;
      json(response, entry);
    });
    const result = await client.callTool({
      name: "get_record",
      arguments: { id: "../records" },
    });
    expect(result.isError).toBe(true);
    const emptyPatch = await client.callTool({
      name: "update_record",
      arguments: { id: entry.id, patch: {} },
    });
    expect(emptyPatch.isError).toBe(true);
    expect(requests).toBe(0);
  });

  it("returns safe actionable API errors without echoing the response body", async () => {
    const client = await connect(
      (_request, response) =>
        json(response, { error: "private test-secret traceback" }, 401),
      { writeToken: "test-secret" },
    );
    const result = await client.callTool({
      name: "list_records",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("WRITE_TOKEN");
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(JSON.stringify(result)).not.toContain("traceback");
  });

  it("validates responses before returning content to the MCP client", async () => {
    const client = await connect((_request, response) =>
      json(response, { records: "bad", private: "secret" }),
    );
    const result = await client.callTool({
      name: "list_records",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("invalid response");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("times out an unresponsive API", async () => {
    const client = await connect(() => {}, { timeoutMs: 25 });
    const result = await client.callTool({
      name: "list_records",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("timed out");
  });

  it("rejects API addresses with embedded secrets or query parameters", () => {
    expect(() =>
      createMcpServer(
        { apiUrl: "https://name:secret@example.com" },
        silentLogger,
      ),
    ).toThrow("must not contain");
    expect(() =>
      createMcpServer(
        { apiUrl: "https://example.com?token=secret" },
        silentLogger,
      ),
    ).toThrow("must not contain");
    expect(() =>
      createMcpServer({ apiUrl: "file:///tmp/socket" }, silentLogger),
    ).toThrow();
  });
});
