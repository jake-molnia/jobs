import { getStore } from "@/lib/db";
import { handleRequest, readJson, requireWriteAccess } from "@/lib/http";
import { listQuerySchema, recordInputSchema } from "@/lib/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleRequest(request, () => {
    const query = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(getStore().list(query));
  });
}

export function POST(request: Request) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const input = recordInputSchema.parse(await readJson(request));
    return Response.json(getStore().upsert(input));
  });
}
