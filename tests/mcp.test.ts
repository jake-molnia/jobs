import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server";
import { recordInputSchema } from "../src/lib/records";

const silentLogger = pino({ level: "silent" });
const entry = {
  ...recordInputSchema.parse({ title: "Research engineer", organization: "Example", url: "https://example.com/role" }),
  id: "3d96337f-ac29-4db1-8fbb-d96794708132",
  createdAt: "2026-09-21T08:00:00.000Z",
  updatedAt: "2026-09-21T08:00:00.000Z",
};
const page = {
  records: [entry],
  total: 1,
  counts: { all: 1, saved: 1, applied: 0, interview: 0, closed: 0 },
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
  if (address === null || typeof address === "string") throw new Error("Missing test server address");
  cleanup.push(async () => {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  });
  const server = createMcpServer({ apiUrl: `http://127.0.0.1:${address.port}`, ...options }, silentLogger);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await server.close(); });
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
    cleanup.push(async () => { await client.close(); });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(4);
    const invalid = await client.callTool({ name: "get_record", arguments: { id: "invalid" } });
    expect(invalid.isError).toBe(true);
  });

  it("advertises its four tools and their write behavior", async () => {
    const client = await connect((_request, response) => json(response, page));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["list_records", "get_record", "upsert_record", "update_record"]);
    expect(tools.find((tool) => tool.name === "list_records")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "upsert_record")?.annotations?.destructiveHint).toBe(true);
  });

  it("sends search filters and pagination, then reads the complete record", async () => {
    const requests: string[] = [];
    const client = await connect((request, response) => {
      requests.push(request.url ?? "");
      json(response, request.url?.includes(entry.id) ? entry : page);
    });
    const listed = await client.callTool({ name: "list_records", arguments: { q: "research & design", status: "saved", kind: "role", sort: "deadline", limit: 12, offset: 24 } });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toEqual(page);
    const query = new URL(requests[0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({ q: "research & design", status: "saved", kind: "role", sort: "deadline", limit: "12", offset: "24" });
    const result = await client.callTool({ name: "get_record", arguments: { id: entry.id } });
    expect(result.structuredContent).toEqual(entry);
    expect(requests[1]).toBe(`/api/records/${entry.id}`);
  });

  it("authenticates writes and only sends supplied patch fields", async () => {
    const requests: Array<{ method?: string; auth?: string; body: unknown }> = [];
    const client = await connect((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method, auth: request.headers.authorization, body: JSON.parse(body) });
        json(response, entry);
      });
    }, { writeToken: "test-secret" });
    const created = await client.callTool({ name: "upsert_record", arguments: { title: entry.title, organization: entry.organization, url: entry.url } });
    expect(created.isError).not.toBe(true);
    const updated = await client.callTool({ name: "update_record", arguments: { id: entry.id, patch: { status: "applied", appliedAt: "2026-09-21" } } });
    expect(updated.isError).not.toBe(true);
    expect(requests[0]).toEqual({ method: "POST", auth: "Bearer test-secret", body: recordInputSchema.parse({ title: entry.title, organization: entry.organization, url: entry.url }) });
    expect(requests[1]).toEqual({ method: "PATCH", auth: "Bearer test-secret", body: { status: "applied", appliedAt: "2026-09-21" } });
  });

  it("rejects invalid tool input before contacting the API", async () => {
    let requests = 0;
    const client = await connect((_request, response) => { requests += 1; json(response, entry); });
    const result = await client.callTool({ name: "get_record", arguments: { id: "../records" } });
    expect(result.isError).toBe(true);
    const emptyPatch = await client.callTool({ name: "update_record", arguments: { id: entry.id, patch: {} } });
    expect(emptyPatch.isError).toBe(true);
    expect(requests).toBe(0);
  });

  it("returns safe actionable API errors without echoing the response body", async () => {
    const client = await connect((_request, response) => json(response, { error: "private test-secret traceback" }, 401), { writeToken: "test-secret" });
    const result = await client.callTool({ name: "list_records", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("WRITE_TOKEN");
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(JSON.stringify(result)).not.toContain("traceback");
  });

  it("validates responses before returning content to the MCP client", async () => {
    const client = await connect((_request, response) => json(response, { records: "bad", private: "secret" }));
    const result = await client.callTool({ name: "list_records", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("invalid response");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("times out an unresponsive API", async () => {
    const client = await connect(() => {}, { timeoutMs: 25 });
    const result = await client.callTool({ name: "list_records", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("timed out");
  });

  it("rejects API addresses with embedded secrets or query parameters", () => {
    expect(() => createMcpServer({ apiUrl: "https://name:secret@example.com" }, silentLogger)).toThrow("must not contain");
    expect(() => createMcpServer({ apiUrl: "https://example.com?token=secret" }, silentLogger)).toThrow("must not contain");
    expect(() => createMcpServer({ apiUrl: "file:///tmp/socket" }, silentLogger)).toThrow();
  });
});
