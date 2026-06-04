import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  collectSiteData,
  DEFAULT_ROOTS,
  mergeRootLists,
  parsePreviewRoots,
} from "./generate-site-data.mjs";

const PROJECT_INDEX_PATH = "/site-data/sunvox-projects.json";

function localPreviewSiteDataPlugin() {
  return {
    name: "local-preview-site-data",
    configureServer(server) {
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
