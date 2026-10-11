import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  repoRoot,
  supportedTaskTypes,
  taskSchemaPath,
} from "../scripts/lib/openclaw-task-lib.mjs";

test("task schema enum matches runner supported task types", () => {
  const schema = JSON.parse(fs.readFileSync(`${repoRoot}/${taskSchemaPath}`, "utf8"));
  const schemaTypes = [...schema.properties.type.enum].sort();
  const runnerTypes = [...supportedTaskTypes].sort();
  assert.deepEqual(schemaTypes, runnerTypes);
});
