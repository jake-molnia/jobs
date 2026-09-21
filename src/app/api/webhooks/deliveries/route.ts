import { getStore } from "@/lib/db";
import { handleRequest, requireWriteAccess } from "@/lib/http";
import { webhookDeliveryQuerySchema } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleRequest(request, () => {
    requireWriteAccess(request);
    const query = webhookDeliveryQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json({
      deliveries: getStore().webhooks.listDeliveries(query),
    });
  });
}
