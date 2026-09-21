import { getStore } from "@/lib/db";
import {
  handleRequest,
  HttpError,
  parseId,
  readJson,
  requireWriteAccess,
} from "@/lib/http";
import { webhookPatchSchema } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const subscription = getStore().webhooks.get(
      parseId((await context.params).id),
    );
    if (!subscription) throw new HttpError(404, "Webhook not found.");
    return Response.json(subscription);
  });
}

export function PATCH(request: Request, context: Context) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const id = parseId((await context.params).id);
    const patch = webhookPatchSchema.parse(await readJson(request));
    const subscription = getStore().webhooks.update(id, patch);
    if (!subscription) throw new HttpError(404, "Webhook not found.");
    return Response.json(subscription);
  });
}

export function DELETE(request: Request, context: Context) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    if (!getStore().webhooks.delete(parseId((await context.params).id)))
      throw new HttpError(404, "Webhook not found.");
    return new Response(null, { status: 204 });
  });
}
