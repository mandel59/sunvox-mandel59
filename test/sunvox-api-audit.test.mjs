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
  const loadProject = audit.apis.find((item) => item.api === "sv_load_from_memory");
  const loadModule = audit.apis.find((item) => item.api === "sv_load_module_from_memory");
  assert.equal(audit.strictArityMismatches.length, 0);
  assert.match(sendEvent.header.text, /int sv_send_event/u);
  assert.match(sendEvent.implementation.text, /SUNVOX_EXPORT int sv_send_event/u);
  assert.equal(sendEvent.parameterCount, 7);
  assert.deepEqual(
    sendEvent.header.parameters.map((parameter) => parameter.name),
    ["slot", "track_num", "note", "vel", "module", "ctl", "ctl_val"],
  );
  assert.ok(
    sendEvent.calls.every((call) => call.argumentCount === sendEvent.parameterCount),
    "sv_send_event calls should use the public seven-argument API",
  );
  assert.ok(setController.calls.some((call) => /sv_set_module_ctl_value\(0, moduleIndex, controllerNumber, controllerValue, 0\)/u.test(call.text)));
  assert.match(audioCallback.header.text, /int sv_audio_callback/u);
  assert.match(audioCallback.implementation.text, /SUNVOX_EXPORT int sv_audio_callback/u);
  assert.equal(audioCallback.parameterCount, 4);
  assert.ok(audioCallback.calls.every((call) => call.argumentCount === audioCallback.parameterCount));
  assert.ok(loadProject.calls.some((call) => call.binding === "js-wrapper" && call.argumentCount === 2));
  assert.ok(loadProject.calls.some((call) => call.binding === "wasm-export" && call.argumentCount === 3));
  assert.ok(loadModule.calls.some((call) => call.binding === "js-wrapper" && call.argumentCount === 5));
  assert.ok(loadModule.calls.some((call) => call.binding === "wasm-export" && call.argumentCount === 6));
});
