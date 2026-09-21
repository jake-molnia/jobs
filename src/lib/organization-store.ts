import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import {
  organizationSchema,
  organizationInputSchema,
  type Organization,
  type OrganizationInput,
  type OrganizationQuery,
} from "./organizations";

export const normalizeOrganizationName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const displayName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ");
const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  payload: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const countRow = z.object({
  all: z.number(),
  saved: z.number(),
  applied: z.number(),
  interview: z.number(),
  offer: z.number(),
  closed: z.number(),
});
const totalRow = z.object({ total: z.number() });
export class OrganizationConflictError extends Error {
  constructor() {
    super("An organization with this name already exists.");
    this.name = "OrganizationConflictError";
  }
}

export function createOrganizationStore(db: DatabaseSync) {
  function decode(row: unknown): Organization {
    const stored = rowSchema.parse(row);
    const counts = countRow.parse(
      db
        .prepare(
          `SELECT count(*) AS 'all',
      coalesce(sum(status='saved'),0) saved, coalesce(sum(status='applied'),0) applied,
      coalesce(sum(status='interview'),0) interview, coalesce(sum(status='offer'),0) offer,
      coalesce(sum(status='closed'),0) closed FROM records WHERE organizationId = ?`,
        )
        .get(stored.id),
    );
    const payload: unknown = JSON.parse(stored.payload);
    return organizationSchema.parse({
      ...organizationInputSchema.parse(payload),
      id: stored.id,
      name: stored.name,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      counts,
    });
  }
  function get(id: string) {
    const row = db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
    return row ? decode(row) : null;
  }
  function ensure(name: string) {
    const key = normalizeOrganizationName(name);
    const existing = db
      .prepare("SELECT id, name FROM organizations WHERE nameKey = ?")
      .get(key);
    if (existing)
      return z.object({ id: z.string(), name: z.string() }).parse(existing);
    const id = randomUUID();
    const canonical = displayName(name);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO organizations(id,name,nameKey,payload,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      canonical,
      key,
      JSON.stringify(
        organizationInputSchema.parse({ name: canonical, kind: "other" }),
      ),
      now,
      now,
    );
    return { id, name: canonical };
  }
  function write(id: string, input: OrganizationInput) {
    const name = displayName(input.name);
    db.prepare(
      "UPDATE organizations SET name=?,nameKey=?,payload=?,updatedAt=? WHERE id=?",
    ).run(
      name,
      normalizeOrganizationName(name),
      JSON.stringify({ ...input, name }),
      new Date().toISOString(),
      id,
    );
    db.prepare(
      "UPDATE records SET organization=?,payload=json_set(payload,'$.organization',?) WHERE organizationId=?",
    ).run(name, name, id);
    return get(id);
  }
  return {
    get,
    ensure,
    list(query: OrganizationQuery) {
      const values: SQLInputValue[] = [];
      const where = query.q
        ? "WHERE instr(casefold(name || ' ' || json_extract(payload,'$.location') || ' ' || json_extract(payload,'$.description')), ?) > 0"
        : "";
      if (query.q) values.push(query.q.toLowerCase());
      const order =
        query.sort === "records"
          ? "(SELECT count(*) FROM records WHERE organizationId=organizations.id) DESC,nameKey,id"
          : "nameKey,id";
      db.exec("BEGIN");
      try {
        const organizations = db
          .prepare(
            `SELECT * FROM organizations ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
          )
          .all(...values, query.limit, query.offset)
          .map(decode);
        const { total } = totalRow.parse(
          db
            .prepare(`SELECT count(*) total FROM organizations ${where}`)
            .get(...values),
        );
        db.exec("COMMIT");
        return { organizations, total };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    upsert(input: OrganizationInput): Organization {
      db.exec("BEGIN IMMEDIATE");
      try {
        const { id } = ensure(input.name);
        const result = write(id, input);
        if (!result)
          throw new Error("Organization write did not return a record.");
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    update(id: string, patch: Partial<OrganizationInput>) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = get(id);
        if (!current) {
          db.exec("COMMIT");
          return null;
        }
        const {
          id: _id,
          counts: _counts,
          createdAt: _created,
          updatedAt: _updated,
          ...input
        } = current;
        void _id;
        void _counts;
        void _created;
        void _updated;
        const result = write(id, { ...input, ...patch });
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        if (
          error instanceof Error &&
          error.message.includes(
            "UNIQUE constraint failed: organizations.nameKey",
          )
        )
          throw new OrganizationConflictError();
        throw error;
      }
    },
  };
}
