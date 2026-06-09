import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  collectSiteData,
  DEFAULT_ROOTS,
  mergeRootLists,
  parsePreviewRoots,
} from "./generate-site-data.mjs";

const PROJECT_INDEX_PATH = "/site-data/sunvox-projects.json";
const SITE_DATA_UPDATE_EVENT = "sunvox-site-data:update";
const LOCAL_SERVER_CONFIG_PATH = "var/local-server.config.json";
const SITE_DATA_WATCH_PATHS = [
  "site-data/sunvox-projects.json",
  "music",
  "instruments",
  "generated/music",
  "generated/instruments",
  "generated/recipes/sunvox-edit",
  "var/synth-lab",
];

function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function readLocalServerConfig() {
  const resolvedPath = resolve(LOCAL_SERVER_CONFIG_PATH);
  if (!existsSync(resolvedPath)) {
    return {};
  }

  let config;
  try {
    config = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${LOCAL_SERVER_CONFIG_PATH}: ${error.message}`);
  }
  const server = config?.server ?? config;
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    throw new Error(`${LOCAL_SERVER_CONFIG_PATH} must contain an object or a { "server": ... } object`);
  }

  const viteServerConfig = {};
  if (server.host !== undefined) {
    if (typeof server.host !== "string" && typeof server.host !== "boolean") {
      throw new Error(`${LOCAL_SERVER_CONFIG_PATH} server.host must be a string or boolean`);
    }
    viteServerConfig.host = server.host;
  }
  if (server.port !== undefined) {
    if (!Number.isInteger(server.port)) {
      throw new Error(`${LOCAL_SERVER_CONFIG_PATH} server.port must be an integer`);
    }
    viteServerConfig.port = server.port;
  }
  if (server.strictPort !== undefined) {
    if (typeof server.strictPort !== "boolean") {
      throw new Error(`${LOCAL_SERVER_CONFIG_PATH} server.strictPort must be a boolean`);
    }
    viteServerConfig.strictPort = server.strictPort;
  }
  if (server.allowedHosts !== undefined) {
    viteServerConfig.allowedHosts =
      server.allowedHosts === true
        ? true
        : assertStringArray(server.allowedHosts, `${LOCAL_SERVER_CONFIG_PATH} server.allowedHosts`);
  }

  return viteServerConfig;
}

function isSiteDataInput(filePath) {
  const relativePath = relative(process.cwd(), filePath).replaceAll("\\", "/");
  return (
    relativePath === "site-data/sunvox-projects.json" ||
    relativePath.startsWith("music/") ||
    relativePath.startsWith("instruments/") ||
    relativePath.startsWith("generated/music/") ||
    relativePath.startsWith("generated/instruments/") ||
    relativePath.startsWith("generated/recipes/sunvox-edit/") ||
    relativePath.startsWith("var/synth-lab/")
  );
}

function localPreviewSiteDataPlugin() {
  return {
    name: "local-preview-site-data",
    configureServer(server) {
      server.watcher.add(SITE_DATA_WATCH_PATHS.map((path) => resolve(path)));
      const notifySiteDataUpdate = (filePath) => {
        if (isSiteDataInput(filePath)) {
          server.ws.send({ type: "custom", event: SITE_DATA_UPDATE_EVENT });
        }
      };
      server.watcher.on("add", notifySiteDataUpdate);
      server.watcher.on("change", notifySiteDataUpdate);
      server.watcher.on("unlink", notifySiteDataUpdate);
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ? new URL(req.url, "http://127.0.0.1") : null;
        if (requestUrl?.pathname !== PROJECT_INDEX_PATH) {
          next();
          return;
        }
        try {
          const environmentPreviewRoots = parsePreviewRoots(process.env.SUNVOX_DEV_ROOTS);
          const requestPreviewRoots = requestUrl.searchParams
            .getAll("roots")
            .flatMap((value) => parsePreviewRoots(value));
          if (!environmentPreviewRoots.length && !requestPreviewRoots.length) {
            next();
            return;
          }
          const data = await collectSiteData(mergeRootLists(DEFAULT_ROOTS, environmentPreviewRoots, requestPreviewRoots));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(`${JSON.stringify(data, null, 2)}\n`);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.PAGES_BASE_PATH || "./",
  plugins: [react(), localPreviewSiteDataPlugin()],
  server: readLocalServerConfig(),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
