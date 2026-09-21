import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError, createStore, type Store } from "../src/lib/db";
import {
  listQuerySchema,
  recordInputSchema,
  recordPatchSchema,
} from "../src/lib/records";

const stores: Store[] = [];
const directories: string[] = [];
function store() {
  const db = createStore(":memory:");
  stores.push(db);
  return db;
}
function input(overrides = {}) {
  return recordInputSchema.parse({
    title: "Engineer",
    organization: "Acme",
    url: "https://example.com/1",
    ...overrides,
  });
}
afterEach(() => {
  stores.splice(0).forEach((db) => db.close());
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("record storage", () => {
  it("upserts the same URL without changing identity or creation time", () => {
    const db = store();
    const first = db.upsert(input({ status: "applied", notes: "Original" }));
    const next = db.upsert(input({ title: "Revised" }));
    expect(next).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      title: "Revised",
      status: "saved",
      notes: "",
    });
    expect(db.list(listQuerySchema.parse({})).total).toBe(1);
  });

  it("patches only supplied fields and rolls back URL collisions", () => {
    const db = store();
    const first = db.upsert(
      input({ status: "applied", notes: "Keep me", tags: ["GPU"] }),
    );
    const second = db.upsert(input({ url: "https://example.com/2" }));
    expect(recordPatchSchema.parse({ title: "Changed" })).toEqual({
      title: "Changed",
    });
    expect(
      db.update(first.id, recordPatchSchema.parse({ title: "Changed" })),
    ).toMatchObject({
      title: "Changed",
      status: "applied",
      notes: "Keep me",
      tags: ["GPU"],
    });
    expect(() => db.update(first.id, { url: second.url })).toThrow(
      ConflictError,
    );
    expect(db.get(first.id)?.url).toBe(first.url);
    expect(db.update("absent", { title: "Missing" })).toBeNull();
    expect(recordPatchSchema.safeParse({}).success).toBe(false);
  });

  it("searches all content fields case insensitively, treats SQL wildcards literally, and retains global counts", () => {
    const db = store();
    const first = db.upsert(
      input({
        title: "Distributed systems",
        organization: "MÜNCHEN",
        location: "Berlin",
        description: "Compiler research",
        notes: "Contact Alice",
        tags: ["GPU", "100%"],
        status: "applied",
      }),
    );
    db.upsert(input({ url: "https://example.com/2", kind: "phd" }));
    for (const q of [
      "DISTRIBUTED",
      "münchen",
      "BERLIN",
      "COMPILER",
      "alice",
      "gpu",
      "%",
    ]) {
      const result = db.list(listQuerySchema.parse({ q }));
      expect(result.records.map((entry) => entry.id)).toEqual([first.id]);
      expect(result.counts).toEqual({
        all: 2,
        saved: 1,
        applied: 1,
        interview: 0,
        offer: 0,
        closed: 0,
      });
    }
    expect(db.list(listQuerySchema.parse({ q: "' OR 1=1 --" })).total).toBe(0);
    expect(
      db.list(listQuerySchema.parse({ status: "saved", kind: "phd" })).total,
    ).toBe(1);
  });

  it("sorts deadlines with missing dates last and paginates without duplicates", () => {
    const db = store();
    const missing = db.upsert(input());
    const late = db.upsert(
      input({
        url: "https://example.com/2",
        deadline: "2027-12-01",
        organization: "Zebra",
      }),
    );
    const early = db.upsert(
      input({
        url: "https://example.com/3",
        deadline: "2027-01-01",
        organization: "Aardvark",
      }),
    );
    expect(
      db
        .list(listQuerySchema.parse({ sort: "deadline" }))
        .records.map((entry) => entry.id),
    ).toEqual([early.id, late.id, missing.id]);
    expect(
      db.list(listQuerySchema.parse({ sort: "organization", limit: 1 }))
        .records[0]?.id,
    ).toBe(early.id);
    const first = db.list(listQuerySchema.parse({ limit: 2 }));
    const second = db.list(listQuerySchema.parse({ limit: 2, offset: 2 }));
    expect(
      new Set([...first.records, ...second.records].map((entry) => entry.id))
        .size,
    ).toBe(3);
    expect(second.total).toBe(3);
  });

  it("refuses a newer schema without replacing its version", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-future-"));
    directories.push(dir);
    const path = join(dir, "records.db");
    const future = new DatabaseSync(path);
    future.exec("PRAGMA user_version = 99");
    future.close();
    expect(() => createStore(path)).toThrow("Database schema is newer");
    const check = new DatabaseSync(path);
    expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(99);
    check.close();
  });

  it("persists records across reopen and supports separate simultaneous connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-store-"));
    directories.push(dir);
    const path = join(dir, "nested", "records.db");
    const first = createStore(path);
    const record = first.upsert(input());
    first.close();
    const reopened = createStore(path);
    stores.push(reopened);
    const other = createStore(path);
    stores.push(other);
    expect(reopened.get(record.id)).toEqual(record);
    other.update(record.id, { notes: "From another process" });
    expect(reopened.get(record.id)?.notes).toBe("From another process");
    expect(reopened.health()).toBe(true);
  });
});
