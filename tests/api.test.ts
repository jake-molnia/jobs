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
import { GET as list, POST as create } from "../src/app/api/records/route";
import { GET as get, PATCH as patch } from "../src/app/api/records/[id]/route";
import { GET as health } from "../src/app/api/health/route";
import { getStore } from "../src/lib/db";
import { recordSchema } from "../src/lib/records";

const directory = mkdtempSync(join(tmpdir(), "apply-api-"));
let serial = 0;
function request(
  path = "/api/records",
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
function input(overrides = {}) {
  return {
    title: "Research fellow",
    organization: "Institute",
    url: `https://example.com/${++serial}`,
    ...overrides,
  };
}
async function createEntry(overrides = {}) {
  const response = await create(request(undefined, "POST", input(overrides)));
  expect(response.status).toBe(200);
  return recordSchema.parse(await response.json());
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(() => vi.stubEnv("DATABASE_PATH", join(directory, "records.db")));
beforeEach(() => vi.stubEnv("WRITE_TOKEN", "test-token"));
afterAll(() => {
  getStore().close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("HTTP API", () => {
  it("allows public reads and checks database health", async () => {
    expect((await list(request())).status).toBe(200);
    const response = await health(request("/api/health"));
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("closes writes when token is missing and rejects incorrect credentials", async () => {
    vi.stubEnv("WRITE_TOKEN", "");
    expect((await create(request(undefined, "POST", input()))).status).toBe(
      503,
    );
    vi.stubEnv("WRITE_TOKEN", "test-token");
    expect(
      (await create(request(undefined, "POST", input(), "wrong"))).status,
    ).toBe(401);
    expect(
      (
        await patch(
          request("/api/records/unknown", "PATCH", { notes: "x" }, "wrong"),
          context("unknown"),
        )
      ).status,
    ).toBe(401);
  });
  it("creates, retrieves, filters, and updates a record without resetting other fields", async () => {
    const entry = await createEntry({
      title: "Specific needle",
      status: "applied",
      notes: "Keep notes",
    });
    expect(
      recordSchema.parse(
        await (
          await get(request(`/api/records/${entry.id}`), context(entry.id))
        ).json(),
      ),
    ).toEqual(entry);
    const response = await patch(
      request(`/api/records/${entry.id}`, "PATCH", { title: "Renamed" }),
      context(entry.id),
    );
    expect(recordSchema.parse(await response.json())).toMatchObject({
      title: "Renamed",
      status: "applied",
      notes: "Keep notes",
    });
    const filtered = await list(
      request("/api/records?q=renamed&status=applied"),
    );
    expect(await filtered.json()).toMatchObject({ total: 1 });
  });
  it("returns validation, not-found, conflict and content errors", async () => {
    expect((await list(request("/api/records?limit=101"))).status).toBe(400);
    expect(
      (
        await create(
          request(undefined, "POST", input({ url: "javascript:alert(1)" })),
        )
      ).status,
    ).toBe(400);
    expect(
      (await create(request(undefined, "POST", input({ unexpected: true }))))
        .status,
    ).toBe(400);
    expect(
      (await get(request("/api/records/bad"), context("bad"))).status,
    ).toBe(400);
    const missing = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      (await get(request(`/api/records/${missing}`), context(missing))).status,
    ).toBe(404);
    const first = await createEntry();
    const second = await createEntry();
    expect(
      (
        await patch(
          request(`/api/records/${first.id}`, "PATCH", { url: second.url }),
          context(first.id),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await patch(
          request(`/api/records/${first.id}`, "PATCH", {}),
          context(first.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await create(
          new Request("http://localhost/api/records", {
            method: "POST",
            headers: {
              authorization: "Bearer test-token",
              "content-type": "application/json",
            },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await create(
          new Request("http://localhost/api/records", {
            method: "POST",
            headers: { authorization: "Bearer test-token" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (await create(request(undefined, "POST", { notes: "x".repeat(65537) })))
        .status,
    ).toBe(413);
  });
});
