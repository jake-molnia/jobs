import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { logger } from "./logger";
import {
  recordSchema,
  type Entry,
  type ListQuery,
  type RecordInput,
  type RecordPage,
} from "./records";

const storedRowSchema = z.object({
  id: z.string(),
  payload: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const countSchema = z.object({ count: z.number() });
const countsSchema = z.object({
  all: z.number(),
  saved: z.number(),
  applied: z.number(),
  interview: z.number(),
  closed: z.number(),
});

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
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  });
}

export function createStore(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
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
    if (version > 1)
      throw new Error(
        "Database schema is newer than this application supports.",
      );
    if (version === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
          organization TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL,
          deadline TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          payload TEXT NOT NULL CHECK(json_valid(payload))
        );
        CREATE INDEX IF NOT EXISTS records_updated ON records(updatedAt DESC, id);
        CREATE INDEX IF NOT EXISTS records_status ON records(status, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS records_kind ON records(kind, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS records_deadline ON records(deadline, id);
        CREATE INDEX IF NOT EXISTS records_organization ON records(organization COLLATE NOCASE, id);
        PRAGMA user_version = 1;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }
  logger.info({ event: "database.ready", schemaVersion: 1 }, "Database ready");

  const get = (id: string): Entry | null => {
    const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
    return row ? decode(row) : null;
  };

  return {
    get,
    list(query: ListQuery): RecordPage {
      const clauses: string[] = [];
      const values: SQLInputValue[] = [];
      if (query.status) {
        clauses.push("status = ?");
        values.push(query.status);
      }
      if (query.kind) {
        clauses.push("kind = ?");
        values.push(query.kind);
      }
      if (query.q) {
        clauses.push(`instr(casefold(title || ' ' || organization || ' ' ||
          json_extract(payload, '$.location') || ' ' || json_extract(payload, '$.tags') || ' ' ||
          json_extract(payload, '$.description') || ' ' || json_extract(payload, '$.notes')), ?) > 0`);
        values.push(query.q.toLowerCase());
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const sort = {
        updated: "updatedAt DESC, id ASC",
        deadline: "deadline IS NULL, deadline ASC, id ASC",
        organization: "organization COLLATE NOCASE ASC, id ASC",
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
            .prepare(`SELECT count(*) AS count FROM records ${where}`)
            .get(...values),
        ).count;
        const counts = countsSchema.parse(
          db
            .prepare(
              `SELECT count(*) AS 'all',
          coalesce(sum(status = 'saved'), 0) AS saved, coalesce(sum(status = 'applied'), 0) AS applied,
          coalesce(sum(status = 'interview'), 0) AS interview, coalesce(sum(status = 'closed'), 0) AS closed FROM records`,
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
      const now = new Date().toISOString();
      const row = db
        .prepare(
          `INSERT INTO records (id, url, title, organization, status, kind, deadline, createdAt, updatedAt, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET title = excluded.title, organization = excluded.organization,
        status = excluded.status, kind = excluded.kind, deadline = excluded.deadline,
        updatedAt = excluded.updatedAt, payload = excluded.payload RETURNING *`,
        )
        .get(
          randomUUID(),
          input.url,
          input.title,
          input.organization,
          input.status,
          input.kind,
          input.deadline,
          now,
          now,
          JSON.stringify(input),
        );
      const entry = decode(row);
      logger.info(
        { event: "record.upsert", recordId: entry.id },
        "Record saved",
      );
      return entry;
    },
    update(id: string, patch: Partial<RecordInput>): Entry | null {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = get(id);
        if (!current) {
          db.exec("COMMIT");
          return null;
        }
        const { id: recordId, createdAt, updatedAt, ...input } = current;
        void recordId;
        void createdAt;
        void updatedAt;
        const next = { ...input, ...patch };
        const row = db
          .prepare(
            `UPDATE records SET url = ?, title = ?, organization = ?, status = ?,
          kind = ?, deadline = ?, updatedAt = ?, payload = ? WHERE id = ? RETURNING *`,
          )
          .get(
            next.url,
            next.title,
            next.organization,
            next.status,
            next.kind,
            next.deadline,
            new Date().toISOString(),
            JSON.stringify(next),
            id,
          );
        const entry = decode(row);
        db.exec("COMMIT");
        logger.info({ event: "record.update", recordId: id }, "Record updated");
        return entry;
      } catch (error) {
        db.exec("ROLLBACK");
        if (
          error instanceof Error &&
          error.message.includes("UNIQUE constraint failed: records.url")
        )
          throw new ConflictError();
        throw error;
      }
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
