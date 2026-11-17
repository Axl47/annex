// Regenerates apps/web/src/routeTree.gen.ts the way the web app's Vite plugin does, so the sync can
// resolve a conflict in that generated file by regenerating it instead of merging it.
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const web = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../apps/web");
const fromWeb = NodeModule.createRequire(NodePath.join(web, "package.json"));
const plugin = NodePath.dirname(fromWeb.resolve("@tanstack/router-plugin/package.json"));
const fromPlugin = NodeModule.createRequire(NodePath.join(plugin, "package.json"));
const generatorDir = NodePath.dirname(
  fromPlugin.resolve("@tanstack/router-generator/package.json"),
);
const { Generator, getConfig } = await import(
  NodeURL.pathToFileURL(NodePath.join(generatorDir, "dist/esm/index.js")).href
);

const config = getConfig({ target: "react", autoCodeSplitting: true }, web);
await new Generator({ config, root: web }).run();
