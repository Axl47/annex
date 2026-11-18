import * as Effect from "effect/Effect";
import { Toolkit } from "effect/ai";

import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { buildFamiliarMcpHandlers } from "./familiar/mcp/handlers.ts";
import { FamiliarToolkit } from "./familiar/mcp/tools.ts";
import { buildGeasMcpHandlers } from "./geas/mcp/handlers.ts";
import { GeasToolkit } from "./geas/mcp/tools.ts";

/** Every Annex MCP tool, registered by McpHttpServer through one seam. */
export const AnnexToolkit = Toolkit.merge(GeasToolkit, FamiliarToolkit);

export const AnnexMcpHandlers = McpToolAccess.toLayer(
  AnnexToolkit,
  Effect.map(Effect.all([buildGeasMcpHandlers, buildFamiliarMcpHandlers]), ([geas, familiar]) => ({
    ...geas,
    ...familiar,
  })),
);
