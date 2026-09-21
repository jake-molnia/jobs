import { getStore } from "@/lib/db";
import { handleRequest, readJson, requireWriteAccess } from "@/lib/http";
import { webhookInputSchema } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleRequest(request, () => {
    requireWriteAccess(request);
    return Response.json({ subscriptions: getStore().webhooks.list() });
  });
}

export function POST(request: Request) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const input = webhookInputSchema.parse(await readJson(request));
    return Response.json(getStore().webhooks.create(input), { status: 201 });
  });
}
