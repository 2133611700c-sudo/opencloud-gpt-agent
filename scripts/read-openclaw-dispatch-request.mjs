#!/usr/bin/env node
import fs from "node:fs";
import {
  dispatchSchemaPath,
  validateSchema,
  validateTaskFilePath,
} from "./lib/openclaw-task-lib.mjs";

const requestFile = process.argv[2];
if (!requestFile) throw new Error("dispatch request file path is required");

const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
const validation = validateSchema(dispatchSchemaPath, request);
if (!validation.valid) {
  throw new Error(`Dispatch schema validation failed for ${requestFile}: ${validation.errors.join("; ")}`);
}
if (!validateTaskFilePath(request.task_file)) {
  throw new Error(`Invalid dispatch task_file: ${request.task_file}`);
}
if (!fs.existsSync(request.task_file)) {
  throw new Error(`Task file does not exist: ${request.task_file}`);
}

process.stdout.write(
  `${JSON.stringify({
    dispatch_file: requestFile,
    task_file: request.task_file,
    force_rerun: Boolean(request.force_rerun),
  })}\n`,
);
