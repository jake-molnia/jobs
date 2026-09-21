import { getStore } from "@/lib/db";
import { handleRequest, HttpError } from "@/lib/http";
import { errorDetails, logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleRequest(request, () => {
    try {
      getStore().health();
    } catch (error) {
      logger.error(
        { event: "database.unhealthy", ...errorDetails(error) },
        "Database health check failed",
      );
      throw new HttpError(503, "Database unavailable.");
    }
    return Response.json({ status: "ok", database: "ok" });
  });
}
