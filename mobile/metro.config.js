const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");
const frontendRoot = path.join(workspaceRoot, "frontend");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [frontendRoot];
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, "node_modules"),
  path.join(frontendRoot, "node_modules"),
];

module.exports = config;
