import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import pino, { type Logger } from "pino";
import { z } from "zod";
import {
  listQuerySchema,
  recordInputSchema,
  recordPageSchema,
  recordPatchSchema,
  recordSchema,
} from "../lib/records";

import {
  organizationInputSchema,
  organizationPageSchema,
  organizationPatchSchema,
  organizationQuerySchema,
  organizationSchema,
} from "../lib/organizations";

import {
  webhookCreatedSchema,
  webhookDeliveryPageSchema,
  webhookDeliveryQuerySchema,
  webhookEventPageSchema,
  webhookHistoryQuerySchema,
  webhookInputSchema,
  webhookListSchema,
  webhookPatchSchema,
  webhookSchema,
} from "../lib/webhook-schemas";

export const mcpLogger = pino(
  { name: "apply-mcp", level: process.env.LOG_LEVEL || "info" },
  pino.destination(2),
);

const optionsSchema = z.object({
  apiUrl: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  writeToken: z.string().optional(),
  timeoutMs: z.number().int().positive().default(15_000),
});

const idSchema = z.object({ id: z.uuid() }).strict();

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "The API rejected this input. Check the supplied fields.";
    case 401:
    case 403:
      return "The API rejected authorization. Check WRITE_TOKEN in the MCP and dashboard environments.";
    case 404:
      return "The requested resource or API endpoint was not found.";
    case 409:
      return "A record URL or organization name conflicts with an existing entry. Find the matching entry and update it by ID.";
    case 413:
      return "The request is too large.";
    case 429:
      return "The API is receiving too many requests. Try again shortly.";
    case 503:
      return "The API is unavailable. Check its configuration and logs.";
    default:
      return `The API returned HTTP ${status}. Check the dashboard logs.`;
  }
}

export function createMcpServer(
  options: z.input<typeof optionsSchema> = {},
  logger: Logger = mcpLogger,
): McpServer {
  const config = optionsSchema.parse(options);
  const baseUrl = new URL(config.apiUrl);
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error(
      "APPLY_API_URL must not contain credentials, a query, or a fragment.",
    );
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api`;

  const server = new McpServer({ name: "apply", version: "1.1.0" });

  async function request<T extends z.ZodObject>(args: {
    tool: string;
    method: "GET" | "POST" | "PATCH";
    schema: T;
    resource?: "records" | "organizations" | "webhooks";
    id?: string;
    suffix?: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  }): Promise<CallToolResult> {
    const startedAt = performance.now();
    const requestId = randomUUID();
    try {
      const url = new URL(baseUrl);
      url.pathname += `/${args.resource ?? "records"}`;
      if (args.id) url.pathname += `/${encodeURIComponent(args.id)}`;
      if (args.suffix) url.pathname += `/${args.suffix}`;
      if (args.query) {
        for (const [key, value] of Object.entries(args.query)) {
          if (value !== undefined && value !== "")
            url.searchParams.set(key, String(value));
        }
      }
      const headers = new Headers({
        Accept: "application/json",
        "X-Request-ID": requestId,
      });
      if (config.writeToken)
        headers.set("Authorization", `Bearer ${config.writeToken}`);
      if (args.body !== undefined)
        headers.set("Content-Type", "application/json");
      const response = await fetch(url, {
        method: args.method,
        headers,
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(statusMessage(response.status), response.status);
      }
      const payload: unknown = await response.json();
      const parsed = args.schema.safeParse(payload);
      if (!parsed.success)
        throw new ApiError(
          "The API returned an invalid response. Check the dashboard version and logs.",
        );
      logger.info(
        {
          requestId,
          tool: args.tool,
          durationMs: Math.round(performance.now() - startedAt),
        },
        "MCP tool completed",
      );
      return {
        content: [{ type: "text", text: JSON.stringify(parsed.data) }],
        structuredContent: parsed.data,
      };
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error &&
              ["TimeoutError", "AbortError"].includes(error.name)
            ? "The API request timed out. Check that the dashboard is running and reachable."
            : "Could not read the API response. Check APPLY_API_URL and that the dashboard is running.";
      logger.error(
        {
          requestId,
          tool: args.tool,
          durationMs: Math.round(performance.now() - startedAt),
          status: error instanceof ApiError ? error.status : undefined,
        },
        message,
      );
      return {
        isError: true,
        content: [
          { type: "text", text: `${message} Request ID: ${requestId}` },
        ],
      };
    }
  }

  server.registerTool(
    "list_records",
    {
      description:
        "Search and filter records by text, organizationId, status, kind, priority, and due dates. Returns records, matching total, and status counts. Use offset and limit to page through results.",
      inputSchema: listQuerySchema,
      outputSchema: recordPageSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (query) =>
      request({
        tool: "list_records",
        method: "GET",
        query,
        schema: recordPageSchema,
      }),
  );

  server.registerTool(
    "get_record",
    {
      description:
        "Read a complete record by its ID, including organizationId, description, notes, role metadata, and follow-up details.",
      inputSchema: idSchema,
      outputSchema: recordSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      request({ tool: "get_record", method: "GET", id, schema: recordSchema }),
  );

  server.registerTool(
    "upsert_record",
    {
      description:
        "Create a record, or replace an existing record with the same URL. Omitted optional fields reset to their defaults. To change selected fields, use update_record. Requires WRITE_TOKEN.",
      inputSchema: recordInputSchema,
      outputSchema: recordSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (body) =>
      request({
        tool: "upsert_record",
        method: "POST",
        body,
        schema: recordSchema,
      }),
  );

  server.registerTool(
    "update_record",
    {
      description:
        "Change selected fields on an existing record. Omitted fields remain unchanged. Set nullable dates, salary, contact, or academic fields to null to clear them. Requires WRITE_TOKEN.",
      inputSchema: idSchema.extend({ patch: recordPatchSchema }),
      outputSchema: recordSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, patch }) =>
      request({
        tool: "update_record",
        method: "PATCH",
        id,
        body: patch,
        schema: recordSchema,
      }),
  );

  server.registerTool(
    "list_organizations",
    {
      description:
        "Search the organization directory with per-status record counts. Use each organization ID with list_records to read its records.",
      inputSchema: organizationQuerySchema,
      outputSchema: organizationPageSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (query) =>
      request({
        tool: "list_organizations",
        resource: "organizations",
        method: "GET",
        query,
        schema: organizationPageSchema,
      }),
  );

  server.registerTool(
    "get_organization",
    {
      description: "Read an organization profile and its record counts by ID.",
      inputSchema: idSchema,
      outputSchema: organizationSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      request({
        tool: "get_organization",
        resource: "organizations",
        method: "GET",
        id,
        schema: organizationSchema,
      }),
  );

  server.registerTool(
    "upsert_organization",
    {
      description:
        "Create or replace an organization profile by normalized name. Omitted optional fields reset to defaults. Requires WRITE_TOKEN.",
      inputSchema: organizationInputSchema,
      outputSchema: organizationSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (body) =>
      request({
        tool: "upsert_organization",
        resource: "organizations",
        method: "POST",
        body,
        schema: organizationSchema,
      }),
  );

  server.registerTool(
    "update_organization",
    {
      description:
        "Change selected profile fields. Renaming an organization updates the name on its records while preserving the organization ID. Requires WRITE_TOKEN.",
      inputSchema: idSchema.extend({ patch: organizationPatchSchema }),
      outputSchema: organizationSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, patch }) =>
      request({
        tool: "update_organization",
        resource: "organizations",
        method: "PATCH",
        id,
        body: patch,
        schema: organizationSchema,
      }),
  );

  server.registerTool(
    "list_webhooks",
    {
      description:
        "List outgoing webhook subscriptions without signing secrets. Requires WRITE_TOKEN.",
      inputSchema: z.object({}).strict(),
      outputSchema: webhookListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      request({
        tool: "list_webhooks",
        resource: "webhooks",
        method: "GET",
        schema: webhookListSchema,
      }),
  );

  server.registerTool(
    "create_webhook",
    {
      description:
        "Register an outgoing webhook. The server must allowlist the destination origin. Filters match event type and the resulting application status. The response includes a signing secret only once; store it securely in the receiver. Requires WRITE_TOKEN. Creating again creates another subscription.",
      inputSchema: webhookInputSchema,
      outputSchema: webhookCreatedSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (body) =>
      request({
        tool: "create_webhook",
        resource: "webhooks",
        method: "POST",
        body,
        schema: webhookCreatedSchema,
      }),
  );

  server.registerTool(
    "update_webhook",
    {
      description:
        "Update supplied subscription fields. Set enabled=false to pause delivery; re-enabling resumes pending deliveries. Changing the URL also changes the destination for pending deliveries. Requires WRITE_TOKEN.",
      inputSchema: idSchema.extend({ patch: webhookPatchSchema }),
      outputSchema: webhookSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, patch }) =>
      request({
        tool: "update_webhook",
        resource: "webhooks",
        method: "PATCH",
        id,
        body: patch,
        schema: webhookSchema,
      }),
  );

  server.registerTool(
    "list_record_events",
    {
      description:
        "Read immutable application change events, optionally for one record. Includes complete record snapshots and previous statuses. Requires WRITE_TOKEN.",
      inputSchema: webhookHistoryQuerySchema,
      outputSchema: webhookEventPageSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (query) =>
      request({
        tool: "list_record_events",
        resource: "webhooks",
        suffix: "events",
        method: "GET",
        query,
        schema: webhookEventPageSchema,
      }),
  );

  server.registerTool(
    "list_webhook_deliveries",
    {
      description:
        "Inspect pending, inflight, succeeded, and failed webhook deliveries, optionally for one subscription. Requires WRITE_TOKEN.",
      inputSchema: webhookDeliveryQuerySchema,
      outputSchema: webhookDeliveryPageSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (query) =>
      request({
        tool: "list_webhook_deliveries",
        resource: "webhooks",
        suffix: "deliveries",
        method: "GET",
        query,
        schema: webhookDeliveryPageSchema,
      }),
  );

  return server;
}
