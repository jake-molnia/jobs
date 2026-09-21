import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { logger } from "./logger";
import {
  countsSchema,
  recordSchema,
  type Entry,
  type ListQuery,
  type RecordInput,
  type RecordPage,
} from "./records";
import { createOrganizationStore } from "./organization-store";
import {
  initializeWebhooks,
  enqueueRecordEvent,
  createWebhookStore,
} from "./webhooks";

const storedRowSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organization: z.string(),
  payload: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const countSchema = z.object({ count: z.number() });
export class ConflictError extends Error {
  constructor() {
    super("A record with this URL already exists.");
    this.name = "ConflictError";
  }
}
function decode(row: unknown): Entry {
  const stored = storedRowSchema.parse(row);
  const payload: unknown = JSON.parse(stored.payload);
  return recordSchema.parse({
    ...z.record(z.string(), z.unknown()).parse(payload),
    id: stored.id,
    organizationId: stored.organizationId,
    organization: stored.organization,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  });
}
function inputOf(entry: Entry): RecordInput {
  const { id, organizationId, createdAt, updatedAt, ...input } = entry;
  void id;
  void organizationId;
  void createdAt;
  void updatedAt;
  return input;
}

export function createStore(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  const organizations = createOrganizationStore(db);
  try {
    db.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;",
    );
    db.function("casefold", (value) =>
      typeof value === "string" ? value.toLowerCase() : "",
    );
    db.exec("BEGIN IMMEDIATE");
    const version = z
      .object({ user_version: z.number() })
      .parse(db.prepare("PRAGMA user_version").get()).user_version;
    if (version > 2)
      throw new Error(
        "Database schema is newer than this application supports.",
      );
    if (version === 0) {
      db.exec(`CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        organization TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL,
        deadline TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload))
      );
      CREATE INDEX IF NOT EXISTS records_updated ON records(updatedAt DESC, id);
      CREATE INDEX IF NOT EXISTS records_status ON records(status, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind, updatedAt DESC);
      CREATE INDEX IF NOT EXISTS records_deadline ON records(deadline, id);
      CREATE INDEX IF NOT EXISTS records_organization ON records(organization COLLATE NOCASE, id);`);
    }
    if (version < 2) {
      db.exec(`CREATE TABLE organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, nameKey TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL CHECK(json_valid(payload)), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      ALTER TABLE records ADD COLUMN organizationId TEXT REFERENCES organizations(id);
      CREATE INDEX records_org_id ON records(organizationId, updatedAt DESC, id);
      CREATE INDEX records_follow_up ON records(json_extract(payload,'$.followUpAt'),id);
      CREATE INDEX records_priority ON records(json_extract(payload,'$.priority'),id);`);
      const legacy = z
        .array(z.object({ id: z.string(), organization: z.string() }))
        .parse(
          db
            .prepare(
              "SELECT id,organization FROM records ORDER BY createdAt,id",
            )
            .all(),
        );
      for (const row of legacy) {
        const organization = organizations.ensure(row.organization);
        db.prepare(
          "UPDATE records SET organizationId=?,organization=?,payload=json_set(payload,'$.organization',?) WHERE id=?",
        ).run(organization.id, organization.name, organization.name, row.id);
      }
      db.exec(`CREATE TRIGGER records_require_organization_insert BEFORE INSERT ON records WHEN NEW.organizationId IS NULL BEGIN SELECT RAISE(ABORT,'organizationId is required'); END;
        CREATE TRIGGER records_require_organization_update BEFORE UPDATE OF organizationId ON records WHEN NEW.organizationId IS NULL BEGIN SELECT RAISE(ABORT,'organizationId is required'); END;`);
      initializeWebhooks(db);
      db.exec("PRAGMA user_version = 2");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }
  logger.info({ event: "database.ready", schemaVersion: 2 }, "Database ready");
  const webhooks = createWebhookStore(db);
  const get = (id: string): Entry | null => {
    const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
    return row ? decode(row) : null;
  };
  function save(input: RecordInput, previous: Entry | null): Entry {
    const organization = organizations.ensure(input.organization);
    const normalized = { ...input, organization: organization.name };
    if (
      previous &&
      JSON.stringify(inputOf(previous)) === JSON.stringify(normalized)
    )
      return previous;
    const now = new Date().toISOString();
    const row = db
      .prepare(
        `INSERT INTO records (id,url,title,organization,organizationId,status,kind,deadline,createdAt,updatedAt,payload)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,title=excluded.title,organization=excluded.organization,
      organizationId=excluded.organizationId,status=excluded.status,kind=excluded.kind,deadline=excluded.deadline,updatedAt=excluded.updatedAt,payload=excluded.payload RETURNING *`,
      )
      .get(
        previous?.id ?? randomUUID(),
        normalized.url,
        normalized.title,
        organization.name,
        organization.id,
        normalized.status,
        normalized.kind,
        normalized.deadline,
        previous?.createdAt ?? now,
        now,
        JSON.stringify(normalized),
      );
    const entry = decode(row);
    enqueueRecordEvent(db, { previous, current: entry });
    return entry;
  }
  function transaction<T>(action: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed: records.url")
      )
        throw new ConflictError();
      throw error;
    }
  }
  return {
    get,
    organizations,
    webhooks,
    list(query: ListQuery): RecordPage {
      const clauses: string[] = [];
      const values: SQLInputValue[] = [];
      for (const [column, value] of [
        ["status", query.status],
        ["kind", query.kind],
        ["organizationId", query.organizationId],
      ]) {
        if (value) {
          clauses.push(`${column} = ?`);
          values.push(value);
        }
      }
      if (query.priority) {
        clauses.push(
          "coalesce(json_extract(payload,'$.priority'),'normal') = ?",
        );
        values.push(query.priority);
      }
      if (query.due) {
        const field =
          query.due === "follow_up"
            ? "json_extract(payload,'$.followUpAt')"
            : "deadline";
        clauses.push(`${field} <= ? AND status != 'closed'`);
        values.push(new Date().toISOString().slice(0, 10));
      }
      if (query.q) {
        clauses.push(`instr(casefold(title || ' ' || organization || ' ' ||
          coalesce(json_extract(payload,'$.location'),'') || ' ' || coalesce(json_extract(payload,'$.tags'),'') || ' ' ||
          coalesce(json_extract(payload,'$.description'),'') || ' ' || coalesce(json_extract(payload,'$.notes'),'') || ' ' ||
          coalesce(json_extract(payload,'$.department'),'') || ' ' || coalesce(json_extract(payload,'$.requirements'),'') || ' ' ||
          coalesce(json_extract(payload,'$.academic'),'') || ' ' || coalesce(json_extract(payload,'$.nextAction'),'')), ?) > 0`);
        values.push(query.q.toLowerCase());
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const sort = {
        updated: "updatedAt DESC,id ASC",
        deadline: "deadline IS NULL,deadline ASC,id ASC",
        organization: "organization COLLATE NOCASE ASC,id ASC",
        priority:
          "CASE json_extract(payload,'$.priority') WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END,updatedAt DESC,id ASC",
        follow_up:
          "json_extract(payload,'$.followUpAt') IS NULL,json_extract(payload,'$.followUpAt') ASC,id ASC",
      }[query.sort];
      db.exec("BEGIN");
      try {
        const records = db
          .prepare(
            `SELECT * FROM records ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
          )
          .all(...values, query.limit, query.offset)
          .map(decode);
        const total = countSchema.parse(
          db
            .prepare(`SELECT count(*) count FROM records ${where}`)
            .get(...values),
        ).count;
        const counts = countsSchema.parse(
          db
            .prepare(
              `SELECT count(*) AS 'all',
          coalesce(sum(status='saved'),0) saved,coalesce(sum(status='applied'),0) applied,
          coalesce(sum(status='interview'),0) interview,coalesce(sum(status='offer'),0) offer,coalesce(sum(status='closed'),0) closed FROM records`,
            )
            .get(),
        );
        db.exec("COMMIT");
        return { records, total, counts };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    upsert(input: RecordInput): Entry {
      const entry = transaction(() => {
        const row = db
          .prepare("SELECT * FROM records WHERE url=?")
          .get(input.url);
        return save(input, row ? decode(row) : null);
      });
      logger.info(
        { event: "record.upsert", recordId: entry.id },
        "Record saved",
      );
      return entry;
    },
    update(id: string, patch: Partial<RecordInput>): Entry | null {
      const entry = transaction(() => {
        const current = get(id);
        return current
          ? save({ ...inputOf(current), ...patch }, current)
          : null;
      });
      if (entry)
        logger.info({ event: "record.update", recordId: id }, "Record updated");
      return entry;
    },
    health() {
      db.prepare("SELECT count(*) FROM records").get();
      return true;
    },
    close() {
      db.close();
    },
  };
}
export type Store = ReturnType<typeof createStore>;
let singleton: Store | undefined;
export function getStore(): Store {
  singleton ??= createStore(process.env.DATABASE_PATH || "data/apply.db");
  return singleton;
}
