import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { buildGeasMcpHandlers } from "./geas/mcp/handlers.ts";
import { GeasToolkit } from "./geas/mcp/tools.ts";

/** Every Annex MCP tool, registered by McpHttpServer through one seam. */
export const AnnexToolkit = GeasToolkit;

export const AnnexMcpHandlers = McpToolAccess.toLayer(AnnexToolkit, buildGeasMcpHandlers);
