import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createStore, type Store } from "../src/lib/db";
import { OrganizationConflictError } from "../src/lib/organization-store";
import {
  organizationInputSchema,
  organizationQuerySchema,
} from "../src/lib/organizations";
import {
  listQuerySchema,
  recordInputSchema,
  recordPatchSchema,
} from "../src/lib/records";
const stores: Store[] = [];
const directories: string[] = [];
function store() {
  const value = createStore(":memory:");
  stores.push(value);
  return value;
}
function input(overrides = {}) {
  return recordInputSchema.parse({
    title: "Engineer",
    organization: "Acme Lab",
    url: "https://example.com/role",
    ...overrides,
  });
}
afterEach(() => {
  stores.splice(0).forEach((value) => value.close());
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});

it("groups normalized organization names and keeps a stable identity through rename", () => {
  const db = store();
  const first = db.upsert(input());
  const second = db.upsert(
    input({
      organization: " acme   LAB ",
      url: "https://example.com/role2",
      status: "offer",
    }),
  );
  expect(second.organizationId).toBe(first.organizationId);
  expect(second.organization).toBe("Acme Lab");
  expect(
    db.organizations.list(organizationQuerySchema.parse({})),
  ).toMatchObject({
    total: 1,
    organizations: [{ counts: { all: 2, offer: 1 } }],
  });
  const profile = db.organizations.upsert(
    organizationInputSchema.parse({
      name: "Acme Lab",
      website: "https://example.com",
      description: "A research studio",
    }),
  );
  expect(profile.id).toBe(first.organizationId);
  db.organizations.update(profile.id, { name: "Acme Research" });
  expect(db.get(first.id)?.organization).toBe("Acme Research");
  expect(db.get(first.id)?.organizationId).toBe(profile.id);
  expect(
    db.list(listQuerySchema.parse({ organizationId: profile.id })).total,
  ).toBe(2);
  expect(db.list(listQuerySchema.parse({ q: "Acme Research" })).total).toBe(2);
  const other = db.organizations.upsert(
    organizationInputSchema.parse({ name: "Elsewhere" }),
  );
  expect(() =>
    db.organizations.update(profile.id, { name: other.name }),
  ).toThrow(OrganizationConflictError);
  expect(db.get(first.id)?.organization).toBe("Acme Research");
});

it("moves records between organizations and rolls back failed moves without orphan organizations or events", () => {
  const db = store();
  const first = db.upsert(input());
  const second = db.upsert(input({ url: "https://example.com/second" }));
  db.update(first.id, { organization: "Second Place" });
  expect(db.organizations.get(first.organizationId)?.counts.all).toBe(1);
  const before = db.webhooks.listEvents({ recordId: second.id }).total;
  expect(() =>
    db.update(second.id, { organization: "Should roll back", url: first.url }),
  ).toThrow();
  expect(
    db.organizations.list(
      organizationQuerySchema.parse({ q: "Should roll back" }),
    ).total,
  ).toBe(0);
  expect(db.webhooks.listEvents({ recordId: second.id }).total).toBe(before);
});

it("persists rich metadata and filters priority, due work, and research terms", () => {
  const db = store();
  const first = db.upsert(
    input({
      priority: "high",
      followUpAt: "2020-01-01",
      nextAction: "Email supervisor",
      status: "applied",
      salary: { min: 40000, max: 60000, currency: "GBP", period: "year" },
      academic: { supervisor: "Dr Lin", funding: "funded", durationMonths: 36 },
      requirements: ["Publications in interaction design"],
    }),
  );
  db.upsert(
    input({
      url: "https://example.com/closed",
      status: "closed",
      followUpAt: "2020-01-01",
    }),
  );
  db.upsert(
    input({
      url: "https://example.com/future",
      followUpAt: "2099-01-01",
      deadline: "2099-02-01",
    }),
  );
  expect(
    db
      .list(listQuerySchema.parse({ due: "follow_up" }))
      .records.map((entry) => entry.id),
  ).toEqual([first.id]);
  expect(
    db.list(listQuerySchema.parse({ priority: "high", q: "Dr Lin" })).total,
  ).toBe(1);
  expect(
    db.list(listQuerySchema.parse({ q: "interaction design" })).total,
  ).toBe(1);
  expect(
    db.list(listQuerySchema.parse({ sort: "priority" })).records[0]?.id,
  ).toBe(first.id);
  const changed = db.update(
    first.id,
    recordPatchSchema.parse({ nextAction: "Prepare questions" }),
  );
  expect(changed).toMatchObject({
    salary: first.salary,
    academic: first.academic,
    priority: "high",
    nextAction: "Prepare questions",
  });
  expect(
    recordPatchSchema.safeParse({
      salary: { min: 60000, max: 40000, currency: "GBP", period: "year" },
    }).success,
  ).toBe(false);
  const count = db.webhooks.listEvents({ recordId: first.id }).total;
  expect(
    db.update(first.id, { nextAction: "Prepare questions" })?.updatedAt,
  ).toBe(changed?.updatedAt);
  expect(db.webhooks.listEvents({ recordId: first.id }).total).toBe(count);
});

it("migrates a v1 database without losing records and backfills organization identity once", () => {
  const dir = mkdtempSync(join(tmpdir(), "apply-migration-"));
  directories.push(dir);
  const path = join(dir, "legacy.db");
  const old = new DatabaseSync(path);
  old.exec(
    `CREATE TABLE records(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,organization TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL,deadline TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))); PRAGMA user_version=1;`,
  );
  const createdAt = "2026-01-01T12:00:00.000Z";
  const ids = [randomUUID(), randomUUID()];
  for (const [index, id] of ids.entries()) {
    const payload = {
      title: "Original record",
      url: `https://example.com/legacy/${index}`,
      organization: index ? "acme lab" : "Acme Lab",
      status: "saved",
      kind: "role",
      notes: "Keep original notes",
    };
    old
      .prepare("INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        payload.url,
        payload.title,
        payload.organization,
        payload.status,
        payload.kind,
        null,
        createdAt,
        createdAt,
        JSON.stringify(payload),
      );
  }
  old.close();
  const migrated = createStore(path);
  stores.push(migrated);
  const records = migrated.list(listQuerySchema.parse({})).records;
  expect(records).toHaveLength(2);
  expect(new Set(records.map((entry) => entry.organizationId)).size).toBe(1);
  expect(records[0]).toMatchObject({
    notes: "Keep original notes",
    createdAt,
    priority: "normal",
    salary: null,
    requirements: [],
  });
  expect(migrated.webhooks.listEvents({}).total).toBe(0);
  const reopened = createStore(path);
  stores.push(reopened);
  expect(
    reopened.organizations.list(organizationQuerySchema.parse({})).total,
  ).toBe(1);
  expect(reopened.list(listQuerySchema.parse({})).records).toEqual(records);
});
