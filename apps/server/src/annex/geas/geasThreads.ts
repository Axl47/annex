import type { ThreadId } from "@t3tools/contracts";

// MCP visibility predicates run synchronously per listed tool, so the geas service keeps the
// set of threads that work on a geas here for them to read.
export const geasThreads = new Set<ThreadId>();
