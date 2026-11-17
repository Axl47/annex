import { expect, it } from "@effect/vitest";

import { advertisedJsonSchema } from "../../../mcp/advertisedJsonSchema.ts";
import { GeasToolkit } from "./tools.ts";

// Clients drop the whole MCP server when one tool's input schema is not an object.
it("advertises an object input schema for every geas tool", () => {
  for (const tool of Object.values(GeasToolkit.tools)) {
    expect(advertisedJsonSchema(tool), tool.name).toMatchObject({ type: "object" });
  }
});
