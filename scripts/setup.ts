import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { run } from "./build-utils.ts";

const buildDir = resolve(import.meta.dirname, "../.build");
const sdkDir = resolve(buildDir, "emsdk");
const sdkRevision = "a7c808831a666cc903fedb906c171a718cd97341";
const sdkVersion = "4.0.20";

mkdirSync(buildDir, { recursive: true });

if (!existsSync(resolve(sdkDir, "emsdk"))) {
  await run("git", [
    "clone",
    "https://github.com/emscripten-core/emsdk.git",
    sdkDir,
  ]);
}

const runInSdk = run({ cwd: sdkDir });
await runInSdk("git", ["checkout", sdkRevision]);

await runInSdk("./emsdk", ["install", sdkVersion]);
await runInSdk("./emsdk", ["activate", sdkVersion]);
