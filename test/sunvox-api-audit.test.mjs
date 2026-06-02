import assert from "node:assert/strict";
import test from "node:test";

import { collectApiAudit } from "../tools/sunvox-api-audit.mjs";

test("audits checked-in SunVox Lib API calls against the source fixture", async () => {
  const audit = await collectApiAudit();

  assert.equal(audit.missingHeader.length, 0);
  assert.equal(audit.missingImplementation.length, 0);
  assert.ok(audit.apis.some((item) => item.api === "sv_send_event" && item.review?.priority === "high"));
  assert.ok(audit.apis.some((item) => item.api === "sv_set_event_t" && item.review?.priority === "high"));
  assert.ok(audit.apis.some((item) => item.api === "sv_new_pattern" && item.review?.priority === "high"));
  assert.ok(audit.apis.some((item) => item.api === "sv_audio_callback" && item.review?.priority === "high"));
  const sendEvent = audit.apis.find((item) => item.api === "sv_send_event");
  const setController = audit.apis.find((item) => item.api === "sv_set_module_ctl_value");
  const audioCallback = audit.apis.find((item) => item.api === "sv_audio_callback");
  assert.match(sendEvent.header.text, /int sv_send_event/u);
  assert.match(sendEvent.implementation.text, /SUNVOX_EXPORT int sv_send_event/u);
  assert.ok(setController.calls.some((call) => /sv_set_module_ctl_value\(0, moduleIndex, controllerNumber, controllerValue, 0\)/u.test(call.text)));
  assert.match(audioCallback.header.text, /int sv_audio_callback/u);
  assert.match(audioCallback.implementation.text, /SUNVOX_EXPORT int sv_audio_callback/u);
});
