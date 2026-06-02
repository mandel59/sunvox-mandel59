import assert from "node:assert/strict";
import test from "node:test";

import { collectApiAudit } from "../tools/sunvox-api-audit.mjs";

test("audits checked-in SunVox Lib API calls against the source fixture", async () => {
  const audit = await collectApiAudit();

  assert.equal(audit.missingHeader.length, 0);
  assert.ok(audit.apis.some((item) => item.api === "sv_send_event" && item.review?.priority === "high"));
  assert.ok(audit.apis.some((item) => item.api === "sv_new_pattern" && item.review?.priority === "high"));
  assert.ok(audit.apis.some((item) => item.api === "sv_audio_callback" && item.review?.priority === "high"));
});
