import assert from "node:assert/strict";
import test from "node:test";

import { collectCodeMetrics, collectFileMetrics } from "../tools/code-metrics.mjs";

test("code metrics summarize tracked JavaScript sources", () => {
  const metrics = collectCodeMetrics(["tools/code-metrics.mjs"]);

  assert.equal(metrics.summary.files, 1);
  assert.ok(metrics.summary.lines > 0);
  assert.ok(metrics.summary.nonBlankLines > 0);
  assert.ok(metrics.summary.functions > 0);
  assert.equal(metrics.largestFiles[0].file.replaceAll("\\", "/"), "tools/code-metrics.mjs");
});

test("file metrics include named function spans", () => {
  const metrics = collectFileMetrics("tools/code-metrics.mjs");
  const collectCodeMetricsFunction = metrics.functions.find((row) => row.name === "collectCodeMetrics");

  assert.ok(collectCodeMetricsFunction);
  assert.ok(collectCodeMetricsFunction.lines > 1);
  assert.ok(collectCodeMetricsFunction.startLine < collectCodeMetricsFunction.endLine);
});
