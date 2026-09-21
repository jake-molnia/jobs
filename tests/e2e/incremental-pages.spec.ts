import { test, expect } from "@playwright/test";
import { organizationSchema } from "../../src/lib/organizations";
import { recordSchema } from "../../src/lib/records";

const headers = { Authorization: "Bearer e2e-write-token" };

test("organization pages append, retry the failed page, and reload on refresh", async ({
  page,
  request,
}) => {
  let lastOrganizationId = "";
  for (let index = 0; index < 101; index++) {
    const response = await request.post("/api/organizations", {
      headers,
      data: { name: `Incremental directory ${String(index).padStart(3, "0")}` },
    });
    expect(response.ok()).toBeTruthy();
    lastOrganizationId = organizationSchema.parse(await response.json()).id;
  }
  const offsets: number[] = [];
  let failNextPage = true;
  await page.route("**/api/organizations?**", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    offsets.push(offset);
    if (offset === 50 && failNextPage) {
      failNextPage = false;
      await route.fulfill({ status: 503, json: { error: "Unavailable" } });
    } else {
      await route.continue();
    }
  });
  await page.goto("/organizations?q=Incremental+directory");
  const organizations = page.getByRole("link", {
    name: /^View Incremental directory/,
  });
  await expect(organizations).toHaveCount(50);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByLabel("Organization directory").getByRole("alert"),
  ).toContainText("could not be loaded");
  await expect(organizations).toHaveCount(50);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(organizations).toHaveCount(100);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(organizations).toHaveCount(101);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect(offsets).toEqual([0, 50, 50, 100]);

  await page.getByRole("button", { name: "Refresh organizations" }).click();
  await expect(page.getByLabel("Organization directory")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(organizations).toHaveCount(101);
  expect(offsets).toEqual([0, 50, 50, 100, 0, 50, 100]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => offsets.length).toBe(10);
  await expect(page.getByLabel("Organization directory")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(offsets.slice(-3)).toEqual([0, 50, 100]);

  await page
    .getByLabel("Search organizations")
    .fill("Incremental directory 100");
  await expect(organizations).toHaveCount(1);
  await expect(organizations).toHaveAccessibleName(
    "View Incremental directory 100",
  );
  expect(offsets.at(-1)).toBe(0);
  await page.goBack();
  await expect(organizations).toHaveCount(101);
  expect(offsets.slice(-3)).toEqual([0, 50, 100]);

  offsets.length = 0;
  await page.goto("/organizations?q=Incremental+directory");
  await expect(organizations).toHaveCount(50);
  const moved = await request.patch(
    `/api/organizations/${lastOrganizationId}`,
    {
      headers,
      data: { name: "Incremental directory 000 first" },
    },
  );
  expect(moved.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(organizations).toHaveCount(100);
  await expect(
    page.getByRole("link", {
      name: "View Incremental directory 000 first",
      exact: true,
    }),
  ).toBeAttached();
  expect(offsets).toEqual([0, 50, 0, 50]);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(organizations).toHaveCount(101);
  expect(offsets).toEqual([0, 50, 0, 50, 100]);
});

test("history appends earlier pages and reloads expanded history when a record changes", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/records", {
    headers,
    data: {
      title: "Incremental history",
      organization: "History lab",
      url: "https://example.com/incremental-history",
    },
  });
  expect(response.ok()).toBeTruthy();
  const record = recordSchema.parse(await response.json());
  for (let index = 0; index < 41; index++) {
    const update = await request.patch(`/api/records/${record.id}`, {
      headers,
      data: { notes: `Revision ${index}` },
    });
    expect(update.ok()).toBeTruthy();
  }
  const offsets: number[] = [];
  let failNextPage = true;
  await page.route(`**/api/records/${record.id}/events?**`, async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    offsets.push(offset);
    if (offset === 20 && failNextPage) {
      failNextPage = false;
      await route.fulfill({ status: 503, json: { error: "Unavailable" } });
    } else {
      await route.continue();
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/?item=${record.id}`);
  const history = page.getByRole("region", { name: "Activity history" });
  const events = history.getByRole("listitem");
  await expect(events).toHaveCount(20);
  await history.getByRole("button", { name: "Earlier activity" }).click();
  await expect(history.getByRole("alert")).toContainText("could not be loaded");
  await expect(events).toHaveCount(20);
  await history.getByRole("button", { name: "Retry" }).click();
  await expect(events).toHaveCount(40);
  await history.getByRole("button", { name: "Earlier activity" }).click();
  await expect(events).toHaveCount(42);
  await expect(events.last()).toContainText("Added to collection");
  await expect(
    history.getByRole("button", { name: "Earlier activity" }),
  ).toHaveCount(0);
  expect(offsets).toEqual([0, 20, 20, 40]);

  const update = await request.patch(`/api/records/${record.id}`, {
    headers,
    data: { status: "interview" },
  });
  expect(update.ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(events).toHaveCount(43);
  await expect(events.first()).toContainText("Saved → Interview");
  expect(offsets).toEqual([0, 20, 20, 40, 0, 20, 40]);
});
