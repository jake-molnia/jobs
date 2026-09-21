import { getStore } from "@/lib/db";
import {
  handleRequest,
  HttpError,
  parseId,
  readJson,
  requireWriteAccess,
} from "@/lib/http";
import { organizationPatchSchema } from "@/lib/organizations";
import { logger } from "@/lib/logger";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return handleRequest(request, async () => {
    const organization = getStore().organizations.get(
      parseId((await context.params).id),
    );
    if (!organization) throw new HttpError(404, "Organization not found.");
    return Response.json(organization);
  });
}
export function PATCH(request: Request, context: Context) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const id = parseId((await context.params).id);
    const organization = getStore().organizations.update(
      id,
      organizationPatchSchema.parse(await readJson(request)),
    );
    if (!organization) throw new HttpError(404, "Organization not found.");
    logger.info(
      { event: "organization.update", organizationId: id },
      "Organization updated",
    );
    return Response.json(organization);
  });
}
