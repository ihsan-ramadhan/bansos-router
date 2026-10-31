#!/usr/bin/env bun
// guard entry: only ./runtime is imported statically, so node reaches the message instead of failing on bun: imports
import { runtimeError } from "./runtime";

const error = runtimeError();
if (error) {
  console.error(error);
  process.exit(1);
}

await import("./index");
