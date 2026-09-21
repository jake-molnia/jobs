import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ConflictError } from "./db";
import { OrganizationConflictError } from "./organization-store";
import { errorDetails, logger } from "./logger";

const maxBodyBytes = 64 * 1024;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function requireWriteAccess(request: Request) {
  const configuredToken = process.env.WRITE_TOKEN;
  if (!configuredToken)
    throw new HttpError(
      503,
      "Writes are disabled. Configure WRITE_TOKEN on the server.",
    );
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!supplied || !timingSafeEqual(hash(supplied), hash(configuredToken))) {
    throw new HttpError(401, "A valid bearer token is required.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new HttpError(415, "Use Content-Type: application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBodyBytes)
    throw new HttpError(413, "Request body exceeds 64 KiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request body exceeds 64 KiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function parseId(id: string): string {
  return z.uuid().parse(id);
}

export async function handleRequest(
  request: Request,
  action: () => Response | Promise<Response>,
): Promise<Response> {
  const started = performance.now();
  const candidate = request.headers.get("x-request-id");
  const requestId =
    candidate && /^[a-zA-Z0-9_-]{1,100}$/.test(candidate)
      ? candidate
      : randomUUID();
  const log = logger.child({
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  let response: Response;
  try {
    response = await action();
  } catch (error) {
    if (error instanceof z.ZodError) {
      response = Response.json(
        {
          error: "Invalid request.",
          issues: error.issues.map(({ path, message }) => ({ path, message })),
          requestId,
        },
        { status: 400 },
      );
    } else if (
      error instanceof HttpError ||
      error instanceof ConflictError ||
      error instanceof OrganizationConflictError
    ) {
      response = Response.json(
        { error: error.message, requestId },
        { status: error instanceof HttpError ? error.status : 409 },
      );
    } else {
      log.error(
        { event: "request.error", ...errorDetails(error) },
        "Request failed",
      );
      response = Response.json(
        { error: "An unexpected error occurred.", requestId },
        { status: 500 },
      );
    }
  }
  response.headers.set("x-request-id", requestId);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  log.info(
    {
      event: "request.complete",
      status: response.status,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    },
    "Request complete",
  );
  return response;
}
