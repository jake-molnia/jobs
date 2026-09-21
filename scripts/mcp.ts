import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, mcpLogger } from "../src/mcp/server";

async function main() {
  const server = createMcpServer({
    apiUrl: process.env.APPLY_API_URL,
    writeToken: process.env.WRITE_TOKEN,
  });
  await server.connect(new StdioServerTransport());
  mcpLogger.info("MCP server connected over stdio");
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    mcpLogger.info("MCP server stopped");
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  mcpLogger.fatal("MCP startup failed. Check APPLY_API_URL, WRITE_TOKEN, and LOG_LEVEL configuration.");
  process.exitCode = 1;
});
