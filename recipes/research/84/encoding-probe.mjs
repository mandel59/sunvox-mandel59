import worker from "../../../worker/index.mjs";

// Artificial fixture only. Diagnostics expose just the compression inputs.
export default {
  async fetch(request, env) {
    const mode = new URL(request.url).searchParams.get("mode");
    let response;
    if (mode === "automatic") {
      const rawRequest = new Request(new URL("/test.sunvox", request.url), request);
      rawRequest.headers.set("Accept-Encoding", "identity");
      const raw = await env.ASSETS.fetch(rawRequest);
      response = new Response(raw.body, { status: raw.status, headers: {
        "Content-Type": "application/octet-stream", "Content-Encoding": "gzip",
      } });
    } else {
      response = await worker.fetch(request, mode === "baseline" ? { ASSETS: env.ASSETS } : env);
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Probe-Accept-Encoding", JSON.stringify(request.headers.get("Accept-Encoding")));
    headers.set("X-Probe-Client-Accept-Encoding", JSON.stringify(request.cf?.clientAcceptEncoding ?? null));
    headers.set("X-Probe-Preserved-Accept-Encoding", JSON.stringify(request.headers.get(env.CLIENT_ACCEPT_ENCODING_HEADER)));
    headers.set("X-Probe-Worker-Encoding", response.headers.get("Content-Encoding") ?? "identity");
    return new Response(response.body, { status: response.status, headers, encodeBody: mode === "automatic" ? "automatic" : "manual" });
  },
};
