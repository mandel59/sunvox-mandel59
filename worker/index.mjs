// Static asset routing: https://developers.cloudflare.com/workers/static-assets/binding/
export function acceptsGzip(header = "") {
  const qualities = new Map();
  for (const entry of header.split(",")) {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith("q="));
    const value = quality === undefined ? 1 : Number(quality.slice(2));
    qualities.set(encoding.trim(), Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  return (qualities.get("gzip") ?? qualities.get("*") ?? 0) > 0;
}

function responseHeaders(response, compressed) {
  const headers = new Headers(response.headers);
  const vary = (headers.get("Vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!vary.some((value) => ["accept-encoding", "*"].includes(value.toLowerCase()))) vary.push("Accept-Encoding");
  headers.set("Vary", vary.join(", "));
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Content-Type", "application/octet-stream");
  if (compressed) {
    headers.set("Content-Encoding", "gzip");
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!/\.(sunvox|sunsynth)$/u.test(url.pathname) || !["GET", "HEAD"].includes(request.method)) {
      return env.ASSETS.fetch(request);
    }
    // Cloudflare normalizes Accept-Encoding; cf retains the client's original value.
    // https://developers.cloudflare.com/fundamentals/reference/http-headers/#accept-encoding
    const encoding = request.cf && "clientAcceptEncoding" in request.cf
      ? request.cf.clientAcceptEncoding ?? ""
      : request.headers.get("Accept-Encoding") ?? "";
    // Range requests keep byte offsets in the original file representation.
    if (!request.headers.has("Range") && acceptsGzip(encoding)) {
      url.pathname += ".gz";
      const compressedRequest = new Request(url, request);
      compressedRequest.headers.set("Accept-Encoding", "identity");
      const compressed = await env.ASSETS.fetch(compressedRequest);
      if (compressed.status === 200 || compressed.status === 304) {
        // Prevent Workers from compressing the already gzipped body again.
        // https://developers.cloudflare.com/workers/runtime-apis/response/#the-encodebody-option
        return new Response(compressed.body, {
          status: compressed.status,
          statusText: compressed.statusText,
          headers: responseHeaders(compressed, true),
          encodeBody: "manual",
        });
      }
      if (compressed.status !== 404) return compressed;
    }
    const rawRequest = new Request(request);
    rawRequest.headers.set("Accept-Encoding", "identity");
    // Assets bindings do not support byte ranges. Ignore them and return the full original.
    rawRequest.headers.delete("Range");
    rawRequest.headers.delete("If-Range");
    const raw = await env.ASSETS.fetch(rawRequest);
    return new Response(raw.body, {
      status: raw.status,
      statusText: raw.statusText,
      headers: responseHeaders(raw, false),
      encodeBody: "manual",
    });
  },
};
