# SunVox asset encoding at the Cloudflare edge

The Worker selects a precompressed sibling for `.sunvox` and `.sunsynth`
downloads without changing their public URLs. GET and HEAD use the same
representation; Range requests return the full original file with status 200.
ETags belong to the selected representation. Responses use
`Vary: Accept-Encoding`; production checks also inspect the final wire encoding
because the edge can decompress a Worker response.

## Issue #84: original quality values are lost

An isolated Worker probe on 2026-10-13 found that deployed Cloudflare requests
lose quality values **before** the Worker runs:

| Client sends | `request.headers` encoding | `request.cf.clientAcceptEncoding` |
| --- | --- | --- |
| `gzip;q=0` | `gzip, br` | `gzip` |
| `gzip;q=0, *;q=1` | `gzip, br` | `gzip` |
| `gzip;q=0.5` | `gzip, br` | `gzip` |
| `identity` | `gzip, br` | `identity` |

Using Workers' automatic response encoding also returned gzip for `gzip;q=0`.
The Worker cannot distinguish that refusal from an ordinary gzip request using
these inputs. Local Wrangler and unit tests retain the original quality values,
so passing them alone does not verify the production behavior.

Cloudflare's [header documentation](https://developers.cloudflare.com/fundamentals/reference/http-headers/#accept-encoding)
describes the original value in `cf.clientAcceptEncoding`.
The discrepancy is tracked in [cloudflare/workerd#5289](https://github.com/cloudflare/workerd/issues/5289),
including the loss of quality weights.

## Proposed Request Header Transform Rule

The candidate workaround is to copy the request header **before** Worker
normalization. [accept-encoding-rule.json](accept-encoding-rule.json) contains
one rule for the `sunvox-projects.ryusei.dev` host and the two asset extensions.
It belongs to the zone's `http_request_late_transform` phase:

```text
Header: X-Sunvox-Client-Accept-Encoding
Operation: Set dynamic
Expression: join(http.request.headers["accept-encoding"], ",")
```

`join` includes all header field lines, including an explicit refusal on a later
line. The rule must overwrite a client-supplied header, and remove it when the
original value is empty or absent. Do not filter the rule to requests with a
nonempty Accept-Encoding: that would leave spoofed values intact.

The configured `CLIENT_ACCEPT_ENCODING_HEADER` tells the Worker to use this
preserved value exclusively. If the header is missing, the Worker returns
identity rather than falling back to Cloudflare's lossy value. When this
configuration is absent, the Worker uses `cf.clientAcceptEncoding` on Cloudflare
and the HTTP header on plain local Requests; a missing cf value means identity.

**The Transform Rule itself is not yet verified.** Current Wrangler OAuth can
deploy Workers but the zone Rulesets API returns `10000 Authentication error`.
Supplying the preserved header manually to the isolated Worker verifies the
Worker behavior only; it does not prove the rule captures the original value.
This change must remain a draft until a real rule is tested, including repeated
header lines, empty/missing values, and spoofed preserved headers.

Before release:

1. With a token permitted to manage Transform Rules, inspect the zone's existing
   phase ruleset. Add this single rule while preserving all other rules. The
   [Cloudflare API guide](https://developers.cloudflare.com/rules/transform/request-header-modification/create-api/)
   describes the required permissions and phase.
2. Test the rule on an isolated custom-domain probe in the same zone. Verify
   `q=0` and wildcard values reach the preserved header unchanged, and client
   supplied values are overwritten or removed. Remove the probe afterward.
3. Review and integrate the validated change into `main`, then run the explicit
   local `npm run cloudflare:deploy` release command.
4. Run the public HTTP checks below and record the main commit, Wrangler Version
   ID, results, and playback confirmation in #84. Keep #84 open until the public
   refusal cases pass.

Deploying the Worker without the rule returns original bytes for ordinary
clients, so compression will be lost until the rule is working. For Midnight
Loop Line that means 2,369,453 bytes instead of 1,602,819 bytes. Keep the rule and
Worker release together. To roll back, restore the previous Worker/configuration
and remove only this rule.

## Reproducible HTTP checks

```sh
node --test --test-isolation=none test/cloudflare-worker.test.mjs
npm run cloudflare:check:encoding
npm run cloudflare:check:encoding -- --asset='generated/instruments/Scratch FMX Tines.sunsynth'
# Override the base URL for a local or isolated environment:
npm run cloudflare:check:encoding -- --url=http://127.0.0.1:8787/
```

The checker uses native HTTP rather than fetch, so it sees actual gzip wire bytes.
It checks GET/HEAD, q=0, gzip, wildcard, identity, empty/missing headers, Range,
representation-specific 304s, isolation headers, and decoded manifest hashes.
It also checks spoofed preserved headers. It prints a compact JSON report and
exits nonzero on any failure. Plain `wrangler dev` does not run a zone Transform
Rule: simulate that rule locally before expecting ordinary gzip cases to pass.

Full remote-probe logs are kept locally under `var/issue-84/`; the Issue carries
the measured values and result summary. The probe returned only artificial test
data and compression-related headers, without recording visitor metadata.

The reproducible probe is [encoding-probe.mjs](../recipes/research/84/encoding-probe.mjs).
Prepare its artificial asset and separate Wrangler configuration with
`node recipes/research/84/prepare-probe.mjs`. Deploy only that configuration
(`var/issue-84/probe/wrangler.json`) to an isolated Worker, inspect GET/HEAD at
`/test.sunvox`, and delete the probe with `wrangler delete --config` afterward.
`?mode=baseline` uses cf without the preservation workaround; `?mode=automatic`
tests Workers' automatic gzip response encoding. The default mode requires the
preserved header, supplied manually for a Worker-only test or by the real rule
for a complete edge test. Do not count the manual test as a verified zone rule.
