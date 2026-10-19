#!/usr/bin/env node
// copies the root package.json version into the pi extension: npm run sync-version
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = rootPkg.version;

const extDir = path.join(root, "extensions", "pi");

// 1. extensions/pi/package.json
const extPkgPath = path.join(extDir, "package.json");
const extPkg = JSON.parse(fs.readFileSync(extPkgPath, "utf8"));
if (extPkg.version !== version) {
  extPkg.version = version;
  fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + "\n");
  console.log(`extensions/pi/package.json -> ${version}`);
}

// 2. extensions/pi/package-lock.json (root entry and its "" package)
const extLockPath = path.join(extDir, "package-lock.json");
const extLock = JSON.parse(fs.readFileSync(extLockPath, "utf8"));
if (extLock.version !== version || extLock.packages?.[""]?.version !== version) {
  extLock.version = version;
  if (extLock.packages?.[""]) extLock.packages[""].version = version;
  fs.writeFileSync(extLockPath, JSON.stringify(extLock, null, 2) + "\n");
  console.log(`extensions/pi/package-lock.json -> ${version}`);
}

// 3. extensions/pi/src/index.ts (EXTENSION_VERSION constant)
const indexPath = path.join(extDir, "src", "index.ts");
let src = fs.readFileSync(indexPath, "utf8");
const updated = src.replace(
  /(const EXTENSION_VERSION = ")[^"]+(")/,
  `$1${version}$2`,
);
if (updated !== src) {
  fs.writeFileSync(indexPath, updated);
  console.log(`extensions/pi/src/index.ts -> ${version}`);
}

console.log(`version synced: ${version}`);
