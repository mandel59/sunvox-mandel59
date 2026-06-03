import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { collectApiAudit } from "../tools/sunvox-api-audit.mjs";

function parseDeclaredFunctionParameterCounts(text) {
  const declarations = new Map();
  const declarationPattern = /declare function\s+(sv_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*:/gu;
  for (const match of text.matchAll(declarationPattern)) {
    const parameters = match[2].trim();
    declarations.set(match[1], parameters ? parameters.split(",").filter((parameter) => parameter.trim()).length : 0);
  }
  return declarations;
}

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
  const init = audit.apis.find((item) => item.api === "sv_init");
  const openSlot = audit.apis.find((item) => item.api === "sv_open_slot");
  const stop = audit.apis.find((item) => item.api === "sv_stop");
  const volume = audit.apis.find((item) => item.api === "sv_volume");
  const deinit = audit.apis.find((item) => item.api === "sv_deinit");
  const connectModule = audit.apis.find((item) => item.api === "sv_connect_module");
  const moduleCount = audit.apis.find((item) => item.api === "sv_get_number_of_modules");
  const moduleFlags = audit.apis.find((item) => item.api === "sv_get_module_flags");
  const moduleInputs = audit.apis.find((item) => item.api === "sv_get_module_inputs");
  const moduleOutputs = audit.apis.find((item) => item.api === "sv_get_module_outputs");
  const moduleType = audit.apis.find((item) => item.api === "sv_get_module_type");
  const moduleCtlName = audit.apis.find((item) => item.api === "sv_get_module_ctl_name");
  const moduleCtlValue = audit.apis.find((item) => item.api === "sv_get_module_ctl_value");
  const patternCountApi = audit.apis.find((item) => item.api === "sv_get_number_of_patterns");
  const patternTracks = audit.apis.find((item) => item.api === "sv_get_pattern_tracks");
  const patternLines = audit.apis.find((item) => item.api === "sv_get_pattern_lines");
  const patternName = audit.apis.find((item) => item.api === "sv_get_pattern_name");
  const patternData = audit.apis.find((item) => item.api === "sv_get_pattern_data");
  const songTpl = audit.apis.find((item) => item.api === "sv_get_song_tpl");
  const ticks = audit.apis.find((item) => item.api === "sv_get_ticks");
  const ticksPerSecond = audit.apis.find((item) => item.api === "sv_get_ticks_per_second");
  const referencedApis = new Set(audit.apis.map((item) => item.api));
  assert.equal(audit.strictArityMismatches.length, 0);
  assert.equal(audit.reviewCoverage.referencedApiCount, audit.apis.length);
  assert.equal(audit.reviewCoverage.reviewedApiCount, audit.reviewedApis.length);
  assert.equal(audit.reviewCoverage.unreviewedApiCount, audit.unreviewedApis.length);
  assert.equal(audit.reviewCoverage.unreviewedApiCount, 0);
  assert.deepEqual(audit.unreviewedApis, []);
  assert.ok(audit.reviewCoverage.byPriority.high >= 1);
  assert.ok(audit.reviewedApis.some((item) => item.api === "sv_send_event" && item.priority === "high"));
  assert.ok(audit.unreviewedApis.every((item) => !audit.apis.find((api) => api.api === item.api).review));
  assert.ok(audit.unreviewedApis.every((item) => item.calls > 0 && item.files.length > 0));
  assert.ok(audit.reviewedButUnreferencedApis.every((api) => !referencedApis.has(api)));
  assert.match(sendEvent.header.text, /int sv_send_event/u);
  assert.match(sendEvent.implementation.text, /SUNVOX_EXPORT int sv_send_event/u);
  assert.equal(sendEvent.parameterCount, 7);
  assert.equal(sendEvent.review.argumentSemantics.vel.range, "1..129");
  assert.equal(sendEvent.review.argumentSemantics.vel.specialValues[0], "default");
  assert.equal(sendEvent.review.argumentSemantics.module.specialValues[0], "empty");
  assert.equal(sendEvent.review.argumentSemantics.module.specialValues["1..65535"], "module number + 1");
  assert.deepEqual(
    sendEvent.header.parameters.map((parameter) => parameter.name),
    ["slot", "track_num", "note", "vel", "module", "ctl", "ctl_val"],
  );
  assert.ok(
    sendEvent.calls.every((call) => call.argumentCount === sendEvent.parameterCount),
    "sv_send_event calls should use the public seven-argument API",
  );
  assert.equal(sendEvent.wrapperParameterCount, 7);
  assert.deepEqual(
    sendEvent.wrapper.parameters.map((parameter) => parameter.name),
    ["slot", "track", "note", "vel", "module", "ctl", "ctl_val"],
  );
  assert.ok(setController.calls.some((call) => /sv_set_module_ctl_value\(0, moduleIndex, controllerNumber, controllerValue, 0\)/u.test(call.text)));
  assert.match(audioCallback.header.text, /int sv_audio_callback/u);
  assert.match(audioCallback.implementation.text, /SUNVOX_EXPORT int sv_audio_callback/u);
  assert.equal(audioCallback.parameterCount, 4);
  assert.equal(audioCallback.review.argumentSemantics.frames.unit, "frames");
  assert.equal(audioCallback.review.argumentSemantics.latency.unit, "frames");
  assert.equal(audioCallback.review.argumentSemantics.out_time.unit, "SunVox system ticks");
  assert.ok(audioCallback.calls.every((call) => call.argumentCount === audioCallback.parameterCount));
  assert.equal(loadProject.parameterCount, 3);
  assert.equal(loadProject.wrapperParameterCount, 2);
  assert.ok(
    loadProject.calls.some(
      (call) =>
        call.binding === "js-wrapper" &&
        call.argumentCount === 2 &&
        call.expectedArgumentCount === 2 &&
        call.expectedArgumentSource === "wrapper",
    ),
  );
  assert.ok(
    loadProject.calls.some(
      (call) =>
        call.binding === "wasm-export" &&
        call.argumentCount === 3 &&
        call.expectedArgumentCount === 3 &&
        call.expectedArgumentSource === "header",
    ),
  );
  assert.equal(loadModule.parameterCount, 6);
  assert.equal(loadModule.wrapperParameterCount, 5);
  assert.equal(loadModule.review.argumentSemantics.data_size.unit, "bytes");
  assert.ok(loadModule.calls.some((call) => call.binding === "js-wrapper" && call.argumentCount === 5));
  assert.ok(loadModule.calls.some((call) => call.binding === "wasm-export" && call.argumentCount === 6));
  assert.equal(init.review.argumentSemantics.freq.unit, "Hz");
  assert.equal(init.review.argumentSemantics.freq.minimum, 44100);
  assert.equal(init.review.argumentSemantics.channels.values[2], "stereo; only supported value documented");
  assert.equal(init.review.argumentSemantics.flags.values.SV_INIT_FLAG_AUDIO_FLOAT32, "desired float32 output stream");
  assert.equal(openSlot.review.argumentSemantics.slot.range, "0..SUNDOG_SOUND_SLOTS-1");
  assert.equal(loadProject.review.argumentSemantics.data_size.unit, "bytes");
  assert.match(stop.review.notes.join(" "), /second call resets/u);
  assert.equal(volume.review.argumentSemantics.vol.range, "0..256");
  assert.equal(
    volume.review.argumentSemantics.vol.specialValues["<0"],
    "ignored; previous volume is returned without changing volume",
  );
  assert.match(deinit.review.notes.join(" "), /not initialized/u);
  assert.match(connectModule.header.text, /USE LOCK\/UNLOCK/u);
  assert.match(connectModule.review.notes.join(" "), /not locked/u);
  assert.equal(moduleCount.review.notes[0], "Returns the number of module slots, not the number of existing modules.");
  assert.equal(moduleFlags.review.argumentSemantics.returnValue.values.SV_MODULE_FLAG_EXISTS, "module slot is occupied");
  assert.equal(moduleFlags.review.argumentSemantics.returnValue.values.SV_MODULE_INPUTS_MASK, "packed input link slot count");
  assert.equal(moduleFlags.review.argumentSemantics.returnValue.specialValues[0], "invalid slot or missing module");
  assert.equal(moduleInputs.review.argumentSemantics.returnValue.size, "(sv_get_module_flags() & SV_MODULE_INPUTS_MASK) >> SV_MODULE_INPUTS_OFF");
  assert.equal(moduleInputs.review.argumentSemantics.returnValue.specialValues["-1"], "empty link slot");
  assert.equal(moduleOutputs.review.argumentSemantics.returnValue.size, "(sv_get_module_flags() & SV_MODULE_OUTPUTS_MASK) >> SV_MODULE_OUTPUTS_OFF");
  assert.equal(moduleType.review.argumentSemantics.returnValue.specialValues['""'], "missing module");
  assert.equal(moduleCtlName.review.argumentSemantics.ctl_num.meaning, "zero-based controller index");
  assert.equal(moduleCtlValue.review.argumentSemantics.scaled.values[2], "final displayed value");
  const newPattern = audit.apis.find((item) => item.api === "sv_new_pattern");
  const setPatternEvent = audit.apis.find((item) => item.api === "sv_set_pattern_event");
  const timeMap = audit.apis.find((item) => item.api === "sv_get_time_map");
  assert.equal(newPattern.review.argumentSemantics.clone.specialValues["<0"], "create a fresh pattern");
  assert.equal(newPattern.review.argumentSemantics.clone.specialValues[">=0"], "clone the specified pattern");
  assert.equal(patternCountApi.review.notes[0], "Returns the number of pattern slots, not the number of non-empty patterns.");
  assert.equal(patternCountApi.review.argumentSemantics.returnValue.notes[0], "A pattern slot is non-empty when sv_get_pattern_lines(slot, index) > 0.");
  assert.equal(patternTracks.review.argumentSemantics.returnValue.meaning, "pattern track count");
  assert.equal(patternLines.review.argumentSemantics.returnValue.unit, "lines");
  assert.equal(patternName.review.argumentSemantics.returnValue.specialValues.NULL, "invalid slot or empty pattern slot");
  assert.equal(patternData.review.argumentSemantics.returnValue.format, "line-major: data[line * tracks + track]");
  assert.equal(setPatternEvent.review.argumentSemantics.ccee.meaning, "pattern controller/effect field");
  assert.equal(timeMap.review.argumentSemantics.dest.size, "len * sizeof(uint32_t)");
  assert.equal(songTpl.review.argumentSemantics.returnValue.unit, "ticks per line");
  assert.equal(ticks.review.argumentSemantics.returnValue.range, "0..0xFFFFFFFF");
  assert.equal(ticksPerSecond.review.argumentSemantics.returnValue.unit, "ticks per second");
});

test("declares browser SunVox wrapper calls used by the player", async () => {
  const [audit, declarationsText] = await Promise.all([
    collectApiAudit({ scanRoots: ["js"] }),
    readFile("js/@types/global.d.ts", "utf8"),
  ]);
  const declaredParameterCounts = parseDeclaredFunctionParameterCounts(declarationsText);
  const playerApis = new Set(
    audit.apis.flatMap((item) =>
      item.calls
        .filter((call) => call.binding === "js-wrapper" && call.file === "js\\player.js")
        .map((call) => call.api),
    ),
  );
  const missing = [...playerApis].filter((api) => !declaredParameterCounts.has(api));
  assert.deepEqual(missing, []);
  const arityMismatches = audit.apis
    .filter((item) => playerApis.has(item.api))
    .filter((item) => declaredParameterCounts.get(item.api) !== item.wrapperParameterCount)
    .map((item) => ({
      api: item.api,
      declared: declaredParameterCounts.get(item.api),
      wrapper: item.wrapperParameterCount,
    }));
  assert.deepEqual(arityMismatches, []);
});
