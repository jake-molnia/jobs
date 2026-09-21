import { getStore } from "@/lib/db";
import { handleRequest, HttpError, parseId, readJson, requireWriteAccess } from "@/lib/http";
import { recordPatchSchema } from "@/lib/records";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return handleRequest(request, async () => {
    const record = getStore().get(parseId((await context.params).id));
    if (!record) throw new HttpError(404, "Record not found.");
    return Response.json(record);
  });
}

export function PATCH(request: Request, context: Context) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const id = parseId((await context.params).id);
    const patch = recordPatchSchema.parse(await readJson(request));
    const record = getStore().update(id, patch);
    if (!record) throw new HttpError(404, "Record not found.");
    return Response.json(record);
  });
}
