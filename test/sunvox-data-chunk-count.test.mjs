import assert from "node:assert/strict";
import test from "node:test";

import { buildContainer, parseContainer, TEXT_FORMAT } from "../tools/sunvox-codec.mjs";

test("encodes module data chunk count from sparse chunk indexes", () => {
  const document = parseContainer(
    buildContainer({
      format: TEXT_FORMAT,
      magic: "SSYN",
      headerTailHex: "00000000",
      _comments: [],
      preludeChunks: [],
      module: {
        flags: { exists: true, initialized: true },
        type: "MetaModule",
        dataChunks: [
          { index: 8, name: "userControllerName", controller: 0, label: "Tone volume" },
          { index: 9, name: "userControllerName", controller: 1, label: "Tone release" },
        ],
      },
      trailingChunks: [],
    }),
  );

  assert.equal(document.module.dataChunkCount, 10);
  assert.deepEqual(
    document.module.dataChunks.map((chunk) => chunk.index),
    [8, 9],
  );
});
