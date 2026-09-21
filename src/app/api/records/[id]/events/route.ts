import { getStore } from "@/lib/db";
import { handleRequest, HttpError, parseId } from "@/lib/http";
import { webhookHistoryQuerySchema } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return handleRequest(request, async () => {
    const recordId = parseId((await context.params).id);
    const store = getStore();
    if (!store.get(recordId)) throw new HttpError(404, "Record not found.");
    const query = webhookHistoryQuerySchema.parse({
      ...Object.fromEntries(new URL(request.url).searchParams),
      recordId,
    });
    return Response.json(store.webhooks.listEvents(query));
  });
}
