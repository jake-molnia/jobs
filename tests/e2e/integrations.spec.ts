import { test, expect } from "@playwright/test";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { z } from "zod";
import { recordSchema } from "../../src/lib/records";
import { organizationSchema } from "../../src/lib/organizations";
import { applicationEventSchema } from "../../src/lib/webhook-schemas";

const headers = { Authorization: "Bearer e2e-write-token" };

test("organization directory groups roles and preserves filter URLs through navigation", async ({
  page,
  request,
}) => {
  const profileResponse = await request.post("/api/organizations", {
    headers,
    data: {
      name: "Directory Studio",
      description: "A shared place for two roles",
      website: "https://example.com/studio",
      location: "London",
    },
  });
  expect(profileResponse.ok()).toBeTruthy();
  const organization = organizationSchema.parse(await profileResponse.json());
  for (const [index, status] of ["saved", "offer"].entries()) {
    expect(
      (
        await request.post("/api/records", {
          headers,
          data: {
            title: `Directory role ${index}`,
            organization: index ? "directory  studio" : "Directory Studio",
            url: `https://example.com/directory/${index}`,
            status,
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.goto("/organizations");
  await page.getByLabel("Search organizations").fill("Directory Studio");
  await expect(page).toHaveURL(/q=Directory/);
  await expect(
    page.getByRole("link", { name: "View Directory Studio", exact: true }),
  ).toContainText("2 items");
  await page
    .getByRole("link", { name: "View Directory Studio", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`organizationId=${organization.id}`));
  await expect(
    page.getByRole("heading", { name: "Directory Studio", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(2);
  await page
    .getByRole("navigation", { name: "Status" })
    .getByRole("button", { name: /^Offer/ })
    .click();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(1);
  await expect(page).toHaveURL(/status=offer/);
  await page.reload();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(1);
  await page.goBack();
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(2);
  await page.goBack();
  await expect(page.getByLabel("Search organizations")).toHaveValue(
    "Directory Studio",
  );
});

test("record deep links display structured metadata, follow-up actions, and state history", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await request.post("/api/records", {
    headers,
    data: {
      title: "Metadata fellowship",
      organization: "Metadata Institute",
      url: "https://example.com/metadata",
      kind: "phd",
      priority: "high",
      department: "Interaction research",
      salary: { min: 32000, max: 36000, currency: "EUR", period: "year" },
      compensation: "Additional conference funding",
      academic: {
        supervisor: "Dr Example",
        group: "Interfaces lab",
        funding: "funded",
        durationMonths: 36,
      },
      contact: { name: "Dr Example", email: "example@example.com" },
      requirements: ["Submit a research proposal"],
      benefits: ["Conference travel allowance"],
      nextAction: "Send proposal outline",
      followUpAt: "2020-01-01",
    },
  });
  expect(response.ok()).toBeTruthy();
  const entry = recordSchema.parse(await response.json());
  expect(
    (
      await request.patch(`/api/records/${entry.id}`, {
        headers,
        data: { status: "interview" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/?item=${entry.id}`);
  const details = page.getByRole("complementary", { name: "Item details" });
  await expect(
    details.getByRole("heading", { name: "Metadata fellowship" }),
  ).toBeVisible();
  await expect(details.getByText("Send proposal outline")).toBeVisible();
  await expect(
    details.getByText("Additional conference funding"),
  ).toBeVisible();
  await expect(details.getByText("Interfaces lab")).toBeVisible();
  await expect(details.getByText("36 months")).toBeVisible();
  await expect(details.getByText("Submit a research proposal")).toBeVisible();
  await expect(details.getByText("Conference travel allowance")).toBeVisible();
  await expect(
    details.getByRole("link", { name: "Dr Example" }),
  ).toHaveAttribute("href", "mailto:example@example.com");
  await expect(details.getByLabel("Activity history")).toContainText(
    "Saved → Interview",
  );
  await page.getByLabel("Filter by priority").selectOption("high");
  await page.getByLabel("Filter by date").selectOption("follow_up");
  await expect(
    page.getByRole("button", {
      name: "View Metadata fellowship at Metadata Institute",
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", {
      name: "View Metadata fellowship at Metadata Institute",
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("production worker delivers a signed state webhook to a local HTTPS receiver", async ({
  request,
}) => {
  const received: { body: string; timestamp: string; signature: string }[] = [];
  const receiver = createServer(
    {
      key: readFileSync("tests/fixtures/webhook-localhost-key.pem"),
      cert: readFileSync("tests/fixtures/webhook-localhost-cert.pem"),
    },
    async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.push({
        body: Buffer.concat(chunks).toString("utf8"),
        timestamp: String(req.headers["x-webhook-timestamp"]),
        signature: String(req.headers["x-webhook-signature"]),
      });
      res.writeHead(204).end();
    },
  );
  receiver.listen(3101, "127.0.0.1");
  await once(receiver, "listening");
  let subscriptionId: string | undefined;
  try {
    const subscribed = await request.post("/api/webhooks", {
      headers,
      data: {
        url: "https://127.0.0.1:3101/receive",
        events: ["application.status_changed"],
        statuses: ["interview"],
      },
    });
    expect(subscribed.status()).toBe(201);
    const subscription = z
      .object({ id: z.uuid(), secret: z.string() })
      .parse(await subscribed.json());
    subscriptionId = subscription.id;
    const saved = await request.post("/api/records", {
      headers,
      data: {
        title: "Webhook role",
        organization: "Local Receiver",
        url: "https://example.com/webhook-production",
      },
    });
    const entry = recordSchema.parse(await saved.json());
    expect(
      (
        await request.patch(`/api/records/${entry.id}`, {
          headers,
          data: { status: "interview" },
        })
      ).ok(),
    ).toBeTruthy();
    await expect.poll(() => received.length, { timeout: 15000 }).toBe(1);
    const delivery = received[0];
    expect(delivery.signature).toBe(
      `sha256=${createHmac("sha256", subscription.secret).update(`${delivery.timestamp}.${delivery.body}`).digest("hex")}`,
    );
    const event = applicationEventSchema.parse(JSON.parse(delivery.body));
    expect(event.type).toBe("application.status_changed");
    expect(event.data.record.id).toBe(entry.id);
    expect(event.data.previousStatus).toBe("saved");
    expect(event.data.record.status).toBe("interview");
    await expect
      .poll(async () => {
        const response = await request.get(
          `/api/webhooks/deliveries?subscriptionId=${subscription.id}`,
          { headers },
        );
        return z
          .object({ deliveries: z.array(z.object({ state: z.string() })) })
          .parse(await response.json()).deliveries[0]?.state;
      })
      .toBe("succeeded");
    const listing = await request.get("/api/webhooks", { headers });
    expect(JSON.stringify(await listing.json())).not.toContain(
      subscription.secret,
    );
  } finally {
    if (subscriptionId)
      await request.delete(`/api/webhooks/${subscriptionId}`, { headers });
    await new Promise<void>((done, error) =>
      receiver.close((failure) => (failure ? error(failure) : done())),
    );
  }
});
