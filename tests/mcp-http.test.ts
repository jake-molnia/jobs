import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, OPTIONS, POST } from "../src/app/mcp/route";

const endpoint = new URL("http://localhost/mcp");
const page = {
  records: [],
  total: 0,
  counts: { all: 0, saved: 0, applied: 0, interview: 0, offer: 0, closed: 0 },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MCP HTTP route", () => {
  it("requires the bearer token before handling any MCP request", async () => {
    vi.stubEnv("WRITE_TOKEN", "test-token");
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    const request = (authorization?: string) =>
      new Request(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: initialize,
      });

    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Bearer wrong"))).status).toBe(401);
    expect((await GET(new Request(endpoint))).status).toBe(401);
    expect(
      (await OPTIONS(new Request(endpoint, { method: "OPTIONS" }))).status,
    ).toBe(401);
    expect(
      (await DELETE(new Request(endpoint, { method: "DELETE" }))).status,
    ).toBe(401);
    const headers = { authorization: "Bearer test-token" };
    expect((await GET(new Request(endpoint, { headers }))).status).toBe(405);
    expect(
      (await DELETE(new Request(endpoint, { method: "DELETE", headers }))).status,
    ).toBe(405);
    expect(
      (await OPTIONS(new Request(endpoint, { method: "OPTIONS", headers })))
        .status,
    ).toBe(405);
    vi.stubEnv("WRITE_TOKEN", "");
    expect((await POST(request("Bearer test-token"))).status).toBe(503);
    expect((await GET(new Request(endpoint))).status).toBe(503);
  });

  it("initializes, lists tools, and calls a read tool with a Streamable HTTP client", async () => {
    vi.stubEnv("WRITE_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new URL(input.toString()).origin).toBe("http://127.0.0.1:3000");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-token",
        );
        return Response.json(page);
      }),
    );
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: "Bearer test-token" } },
      fetch: (input, init) => {
        const request = new Request(input, init);
        if (request.method === "GET") return GET(request);
        if (request.method === "DELETE") return DELETE(request);
        return POST(request);
      },
    });
    const client = new Client({ name: "http-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("list_records");
      const result = await client.callTool({
        name: "list_records",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(page);
    } finally {
      await client.close();
    }
  });
});
