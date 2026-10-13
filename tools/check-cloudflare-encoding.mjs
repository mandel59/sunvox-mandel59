#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

// Native HTTP preserves wire bytes; fetch() automatically decompresses gzip.
function request(url, method, headers) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(url, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("HTTP request timed out")));
    req.end();
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string", default: "https://sunvox-projects.ryusei.dev/" },
    asset: { type: "string", default: "generated/music/midnight-loop-line.sunvox" },
    manifest: { type: "string", default: "generated/manifest.json" },
  } });
  const manifest = JSON.parse(await readFile(values.manifest, "utf8"));
  const asset = manifest.assets.find((entry) => entry.path === values.asset);
  assert.ok(asset, `Asset is missing from ${values.manifest}: ${values.asset}`);
  const url = new URL(asset.path.split("/").map(encodeURIComponent).join("/"), values.url);
  assert.ok(["http:", "https:"].includes(url.protocol), "Expected an HTTP(S) base URL");
  const results = [];
  const etags = new Map();
  async function check(method, encoding, expectedEncoding, extraHeaders = {}, status = 200) {
    const label = `${method} ${encoding === "" ? "(empty)" : encoding ?? "(absent)"}${extraHeaders.Range ? " Range" : ""}${status === 304 ? " conditional" : ""}${extraHeaders["X-Sunvox-Client-Accept-Encoding"] ? " spoofed preserved header" : ""}`;
    const result = { label };
    try {
      const headers = { ...extraHeaders };
      if (encoding !== undefined) headers["Accept-Encoding"] = encoding;
      const response = await request(url, method, headers);
      result.status = response.status;
      result.encoding = response.headers["content-encoding"] ?? "identity";
      result.wireBytes = response.body.length;
      result.etag = response.headers.etag;
      assert.equal(response.status, status, "HTTP status");
      assert.ok(expectedEncoding.includes(result.encoding), `Unexpected encoding: ${result.encoding}`);
      assert.ok((response.headers.vary ?? "").toLowerCase().split(",").some((value) => value.trim() === "accept-encoding"), "Missing Vary: Accept-Encoding");
      assert.equal(response.headers["content-type"], "application/octet-stream");
      assert.equal(response.headers["cross-origin-opener-policy"], "same-origin");
      assert.equal(response.headers["cross-origin-embedder-policy"], "require-corp");
      assert.ok(result.etag, "Missing representation ETag");
      if (status === 304) assert.equal(result.etag, extraHeaders["If-None-Match"]);
      if (method === "HEAD" || status === 304) {
        assert.equal(response.body.length, 0, "Unexpected response body");
      } else {
        const body = result.encoding === "gzip" ? gunzipSync(response.body) : response.body;
        assert.equal(body.length, asset.bytes, "Decoded byte count");
        result.sha256 = createHash("sha256").update(body).digest("hex");
        assert.equal(result.sha256, asset.sha256, "Manifest SHA-256");
        if (encoding === "identity" || encoding === "gzip") etags.set(result.encoding, result.etag);
      }
      result.ok = true;
    } catch (error) {
      result.ok = false;
      result.error = error.message;
    }
    results.push(result);
  }
  for (const [encoding, expected] of [
    ["gzip;q=0", ["identity"]], ["gzip;q=0, *;q=1", ["identity"]],
    ["br;q=0, gzip;q=0", ["identity"]], ["identity", ["identity"]],
    ["gzip", ["gzip"]], ["gzip;q=0.5", ["gzip"]],
    ["*;q=1", ["identity", "gzip"]], ["", ["identity"]],
    [undefined, ["identity"]], ["br", ["identity"]],
  ]) {
    for (const method of ["GET", "HEAD"]) await check(method, encoding, expected);
  }
  for (const method of ["GET", "HEAD"]) {
    await check(method, "gzip", ["identity"], { Range: "bytes=0-10", "If-Range": '"stale"' });
    for (const encoding of ["identity", "gzip"]) {
      const etag = etags.get(encoding);
      if (etag) await check(method, encoding, [encoding], { "If-None-Match": etag }, 304);
    }
  }
  for (const encoding of ["gzip;q=0", "identity", undefined]) {
    await check("GET", encoding, ["identity"], { "X-Sunvox-Client-Accept-Encoding": "gzip" });
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(JSON.stringify({ url: url.href, passed: results.length - failed, failed, results }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
