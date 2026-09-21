import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GET } from "../src/app/api/health/route";

it("returns 503 without exposing filesystem details when the database cannot open", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apply-unavailable-"));
  vi.stubEnv("DATABASE_PATH", directory);
  try {
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: "Database unavailable." });
    expect(JSON.stringify(body)).not.toContain(directory);
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
