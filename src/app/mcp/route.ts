import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handleRequest, requireWriteAccess } from "@/lib/http";
import { createMcpServer } from "@/mcp/server";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleRequest(request, async () => {
    requireWriteAccess(request);
    const server = createMcpServer({
      apiUrl: "http://127.0.0.1:3000",
      writeToken: process.env.WRITE_TOKEN,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  });
}

function unsupported(request: Request) {
  return handleRequest(request, () => {
    requireWriteAccess(request);
    return new Response(null, { status: 405 });
  });
}

export const GET = unsupported;
export const DELETE = unsupported;
export const HEAD = unsupported;
export const OPTIONS = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
