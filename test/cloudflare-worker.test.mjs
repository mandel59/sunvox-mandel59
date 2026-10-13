import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import worker, { acceptsGzip } from "../worker/index.mjs";

const raw = Buffer.from("SVOX compression test ".repeat(40));
const compressed = gzipSync(raw);
function mockAssets({ missingGzip = false, status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    ASSETS: {
      async fetch(request) {
        calls.push(request);
        const gzip = new URL(request.url).pathname.endsWith(".gz");
        const responseStatus = gzip && missingGzip ? 404 : status;
        const bytes = gzip ? compressed : raw;
        return new Response(request.method === "HEAD" || responseStatus === 304 ? null : bytes, {
          status: responseStatus,
          headers: { "Content-Type": gzip ? "application/gzip" : "application/octet-stream", ETag: gzip ? '"gzip"' : '"raw"', Vary: "Origin" },
        });
      },
    },
  };
}

test("gzip negotiation honors explicit refusal and wildcard quality", () => {
  for (const header of ["gzip", "br, gzip;q=0.5", "GZIP ; q=1", "*;q=0.1"]) assert.equal(acceptsGzip(header), true, header);
  for (const header of ["", "br", "gzip;q=0", "*;q=1,gzip;q=0", "gzip;q=bogus", "gzip;q=2"]) assert.equal(acceptsGzip(header), false, header);
});

test("gzip responses keep the public URL, use gzip bytes, preserve query and vary", async () => {
  const env = mockAssets();
  const request = new Request("https://site.test/generated/instruments/Scratch%20Analog.sunsynth?v=1", { headers: { "Accept-Encoding": "gzip" } });
  const response = await worker.fetch(request, env);
  assert.equal(env.calls[0].url, "https://site.test/generated/instruments/Scratch%20Analog.sunsynth.gz?v=1");
  assert.equal(env.calls[0].headers.get("Accept-Encoding"), "identity");
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(response.headers.get("Vary"), "Origin, Accept-Encoding");
  assert.equal(response.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
  assert.deepEqual(gunzipSync(Buffer.from(await response.arrayBuffer())), raw);
});

test("refused gzip, absent gzip siblings and range requests return original bytes", async () => {
  for (const [headers, options, expectedCalls] of [
    [{ "Accept-Encoding": "gzip;q=0, *;q=1" }, {}, 1],
    [{ "Accept-Encoding": "gzip" }, { missingGzip: true }, 2],
    [{ "Accept-Encoding": "gzip", Range: "bytes=0-10" }, {}, 1],
    [{}, {}, 1],
  ]) {
    const env = mockAssets(options);
    const response = await worker.fetch(new Request("https://site.test/music/test.sunvox", { headers }), env);
    assert.equal(env.calls.length, expectedCalls);
    assert.equal(env.calls.at(-1).headers.get("Accept-Encoding"), "identity");
    assert.equal(env.calls.at(-1).headers.get("Range"), null);
    assert.equal(response.headers.get("Content-Encoding"), null);
    assert.match(response.headers.get("Vary"), /Accept-Encoding/u);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), raw);
  }
});

test("HEAD and conditional responses retain the gzip representation headers", async () => {
  for (const [method, status] of [["HEAD", 200], ["GET", 304]]) {
    const env = mockAssets({ status });
    const response = await worker.fetch(new Request("https://site.test/music/test.sunvox", { method, headers: { "Accept-Encoding": "gzip", "If-None-Match": '"gzip"' } }), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Content-Encoding"), "gzip");
    assert.equal(response.headers.get("ETag"), '"gzip"');
    assert.equal(env.calls[0].headers.get("If-None-Match"), '"gzip"');
    assert.equal(await response.text(), "");
  }
});

test("unrelated paths and unsupported methods pass through; gzip failures propagate", async () => {
  for (const [path, method] of [["/index.html", "GET"], ["/song.sunvox", "POST"]]) {
    const env = mockAssets();
    await worker.fetch(new Request(`https://site.test${path}`, { method }), env);
    assert.equal(new URL(env.calls[0].url).pathname, path);
  }
  const env = mockAssets({ status: 500 });
  assert.equal((await worker.fetch(new Request("https://site.test/song.sunvox", { headers: { "Accept-Encoding": "gzip" } }), env)).status, 500);
  assert.equal(env.calls.length, 1);
});


test("Cloudflare's original client encoding takes precedence over the normalized header", async () => {
  for (const encoding of ["identity", "gzip;q=0, *;q=1", "", null, undefined]) {
    const env = mockAssets();
    const request = new Request("https://site.test/song.sunvox", { headers: { "Accept-Encoding": "br, gzip" } });
    request.cf = { clientAcceptEncoding: encoding };
    const response = await worker.fetch(request, env);
    assert.equal(response.headers.get("Content-Encoding"), null);
    assert.equal(env.calls.length, 1);
  }
  const env = mockAssets();
  const request = new Request("https://site.test/song.sunvox", { headers: { "Accept-Encoding": "identity" } });
  request.cf = { clientAcceptEncoding: "gzip" };
  assert.equal((await worker.fetch(request, env)).headers.get("Content-Encoding"), "gzip");
});

test("preserved client encoding overrides Cloudflare's stripped quality values", async () => {
  for (const [encoding, compressedResponse] of [
    ["gzip;q=0", false], ["gzip;q=0, *;q=1", false], ["*;q=1, gzip;q=0", false], ["identity", false],
    ["gzip", true], ["gzip;q=0.5", true], ["*;q=1", true], ["", false], [null, false],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const env = { ...mockAssets(), CLIENT_ACCEPT_ENCODING_HEADER: "X-Sunvox-Client-Accept-Encoding" };
      const headers = { "Accept-Encoding": "gzip, br" };
      if (encoding !== null) headers[env.CLIENT_ACCEPT_ENCODING_HEADER] = encoding;
      const request = new Request("https://site.test/song.sunvox", { method, headers });
      request.cf = { clientAcceptEncoding: "gzip" };
      const response = await worker.fetch(request, env);
      assert.equal(response.headers.get("Content-Encoding"), compressedResponse ? "gzip" : null, `${method}: ${encoding}`);
      assert.equal(env.calls.length, 1);
      if (method === "GET") {
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(compressedResponse ? gunzipSync(bytes) : bytes, raw);
      } else {
        assert.equal(await response.text(), "");
      }
    }
  }
});

test("preserved gzip still honors Range and representation-specific conditional requests", async () => {
  for (const [method, status, range] of [["GET", 200, true], ["HEAD", 304, false], ["GET", 304, false]]) {
    const env = { ...mockAssets({ status }), CLIENT_ACCEPT_ENCODING_HEADER: "X-Sunvox-Client-Accept-Encoding" };
    const headers = { "Accept-Encoding": "gzip, br", "X-Sunvox-Client-Accept-Encoding": "gzip", "If-None-Match": range ? '"raw"' : '"gzip"' };
    if (range) headers.Range = "bytes=0-10";
    const response = await worker.fetch(new Request("https://site.test/song.sunvox", { method, headers }), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Content-Encoding"), range ? null : "gzip");
    assert.equal(response.headers.get("ETag"), headers["If-None-Match"]);
    assert.equal(env.calls[0].headers.get("If-None-Match"), headers["If-None-Match"]);
    if (range) assert.deepEqual(Buffer.from(await response.arrayBuffer()), raw);
  }
});
