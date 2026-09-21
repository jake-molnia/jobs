import { getStore } from "@/lib/db";
import { handleRequest, readJson, requireWriteAccess } from "@/lib/http";
import {
  organizationInputSchema,
  organizationQuerySchema,
} from "@/lib/organizations";
import { logger } from "@/lib/logger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handleRequest(request, () =>
    Response.json(
      getStore().organizations.list(
        organizationQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    ),
  );
}
export function POST(request: Request) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const organization = getStore().organizations.upsert(
      organizationInputSchema.parse(await readJson(request)),
    );
    logger.info(
      { event: "organization.upsert", organizationId: organization.id },
      "Organization saved",
    );
    return Response.json(organization);
  });
}
