import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { relative, resolve } from "node:path";
import {
  collectSiteData,
  DEFAULT_ROOTS,
  mergeRootLists,
  parsePreviewRoots,
} from "./generate-site-data.mjs";

const PROJECT_INDEX_PATH = "/site-data/sunvox-projects.json";
const SITE_DATA_UPDATE_EVENT = "sunvox-site-data:update";
const SITE_DATA_WATCH_PATHS = [
  "site-data/sunvox-projects.json",
  "music",
  "instruments",
  "generated/music",
  "generated/instruments",
  "generated/recipes/sunvox-edit",
  "var/synth-lab",
];

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
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
