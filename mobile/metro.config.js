const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Monorepo support: let Metro see the shared workspace package (symlinked
// into mobile/node_modules by npm workspaces) and resolve node_modules
// hoisted to the workspace root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// expo-sqlite's web worker imports its wasm binary as a module
// (`import wasmModule from "./wa-sqlite.wasm"`); Metro only bundles that
// correctly for `expo export --platform web` if .wasm is registered as a
// static asset extension. `expo start --web`'s dev server resolves it
// without this, which is why the gap only shows up in a production build.
config.resolver.assetExts.push("wasm");

module.exports = config;
