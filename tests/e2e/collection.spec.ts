import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { recordSchema } from "../../src/lib/records";

const headers = { Authorization: "Bearer e2e-write-token" };
const records = [
  {
    title: "Interface engineer",
    organization: "Alpha Studio",
    url: "https://example.com/interface",
    status: "saved",
    kind: "role",
    tags: ["React"],
    description: "Build accessible interfaces.",
    notes: "Review portfolio.",
    location: "Remote",
  },
  {
    title: "Doctoral researcher",
    organization: "Beta University",
    url: "https://example.com/research",
    status: "applied",
    kind: "phd",
    tags: ["HCI"],
    deadline: "2026-11-01",
    appliedAt: "2026-09-20",
  },
  {
    title: "Research engineer",
    organization: "Gamma Lab",
    url: "https://example.com/lab",
    status: "interview",
    kind: "research",
    tags: ["Python"],
  },
];

test.beforeAll(async ({ request }) => {
  for (const data of records) {
    const response = await request.post("/api/records", { headers, data });
    expect(response.ok()).toBeTruthy();
  }
});

test("search, status, type, sort, details, and external links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(3);
  await page.getByLabel("Sort collection").selectOption("organization");
  await expect(
    page.getByRole("button", { name: /^View / }).first(),
  ).toHaveAccessibleName("View Interface engineer at Alpha Studio");
  await page
    .getByRole("button", { name: "View Interface engineer at Alpha Studio" })
    .click();
  const details = page.getByRole("complementary", { name: "Item details" });
  await expect(details.getByText("Build accessible interfaces.")).toBeVisible();
  await expect(details.getByText("Review portfolio.")).toBeVisible();
  const link = details.getByRole("link", { name: "Open listing" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("href", records[0].url);
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ body: "Source listing" }),
  );
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(records[0].url);
  await popup.close();
  await page.getByLabel("Search collection").fill("HCI");
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "View Doctoral researcher at Beta University",
    }),
  ).toBeVisible();
  await page.getByLabel("Clear search").click();
  await page
    .getByRole("navigation", { name: "Status" })
    .getByRole("button", { name: /^Applied/ })
    .click();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(1);
  await page.getByLabel("Filter by type").selectOption("role");
  await expect(page.getByText("No matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("mobile details are keyboard accessible without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const item = page.getByRole("button", {
    name: "View Interface engineer at Alpha Studio",
  });
  await item.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Review portfolio.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(item).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("failed reads can be retried", async ({ page }) => {
  await page.route("**/api/records?**", (route) =>
    route.fulfill({ status: 500, json: { error: "Unavailable" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be loaded" }),
  ).toContainText("could not be loaded");
  await page.unroute("**/api/records?**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(3);
});

test("empty collection has a quiet empty state", async ({ page }) => {
  await page.route("**/api/records?**", (route) =>
    route.fulfill({
      json: {
        records: [],
        total: 0,
        counts: { all: 0, saved: 0, applied: 0, interview: 0, closed: 0 },
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /add|create|sign in/i }),
  ).toHaveCount(0);
});

test("MCP writes reach the dashboard and partial updates preserve content", async ({
  page,
}) => {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: resolve("node_modules/.bin/tsx"),
    args: [resolve("scripts/mcp.ts")],
    env: {
      PATH: process.env.PATH ?? "",
      APPLY_API_URL: "http://127.0.0.1:3100",
      WRITE_TOKEN: "e2e-write-token",
      LOG_LEVEL: "error",
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "upsert_record",
      arguments: {
        title: "MCP-created record",
        organization: "Tool Studio",
        url: "https://example.com/mcp-e2e",
        notes: "Keep these notes",
        tags: ["MCP"],
      },
    });
    expect(result.isError).not.toBe(true);
    const entry = recordSchema.parse(result.structuredContent);
    const update = await client.callTool({
      name: "update_record",
      arguments: { id: entry.id, patch: { status: "applied" } },
    });
    expect(recordSchema.parse(update.structuredContent).notes).toBe(
      "Keep these notes",
    );
    await page.goto("/");
    await page.getByLabel("Search collection").fill("MCP-created");
    await expect(
      page.getByRole("button", {
        name: "View MCP-created record at Tool Studio",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^View / })).toHaveCount(1);
  } finally {
    await client.close();
    await transport.close();
  }
});

test("load more retrieves records beyond the first page", async ({
  page,
  request,
}) => {
  for (let index = 0; index < 53; index++) {
    const response = await request.post("/api/records", {
      headers,
      data: {
        title: `Paged item ${index}`,
        organization: "Paging Lab",
        url: `https://example.com/paging/${index}`,
        tags: ["pagination-test"],
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto("/");
  const filteredResponse = page.waitForResponse(
    (response) => response.url().includes("q=pagination-test") && response.ok(),
  );
  await page.getByLabel("Search collection").fill("pagination-test");
  await filteredResponse;
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(50);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(53);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  const last = page.getByRole("button", { name: /^View / }).last();
  await last.click();
  const selectedName = await last.getAttribute("aria-label");
  const refreshed = page.waitForResponse(
    (response) => response.url().includes("offset=50") && response.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page.locator("#collection-list")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(53);
  await expect(
    page.getByRole("button", { name: selectedName ?? "" }),
  ).toHaveAttribute("aria-pressed", "true");
});
