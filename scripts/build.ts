import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync as read,
  writeFileSync as write,
} from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { oraPromise } from "ora";
import pc from "picocolors";

import {
  buildWad,
  compileEngine,
  encodePayload,
  prepareSources,
  renderGameHtml,
  run,
} from "./build-utils.ts";

process.chdir(resolve(import.meta.dirname, ".."));

const startedAt = performance.now();
const outputFile = resolve("dist/doom.html");

console.log(pc.bold("DOOM in Slack"));
console.log(pc.dim("Preparing DoomGeneric sources and Freedoom assets…"));
mkdirSync(".build", { recursive: true });
mkdirSync("licenses", { recursive: true });
mkdirSync("dist", { recursive: true });

const { original, notices } = await prepareSources();

const { conservative, game, trimStats } = buildWad(original);

write(".build/doom1.wad", game);

const { runtime, sdkVersion, wasmTarget } = await oraPromise(compileEngine(), {
  text: "Compiling the game engine to WebAssembly…",
  successText: pc.dim("Game engine compiled"),
  failText: pc.red("Engine compilation failed"),
});
if (/\beval\s*\(|new Function\s*\(/.test(runtime)) {
  throw new Error("Dynamic execution in generated runtime");
}

console.log(pc.dim("Packaging the game and source archive…"));
const wasm = encodePayload(read(".build/engine.wasm"));
const wad = encodePayload(game);

const html = await renderGameHtml(runtime, wasm.encoded, wad.encoded, notices);
write(outputFile, html);

const sizes = {
  originalWad: original.length,
  conservativeWad: {
    raw: conservative.length,
    gzip: gzipSync(conservative, { level: 9 }).length,
  },
  trim: trimStats,
  wasm: wasm.sizes,
  wad: wad.sizes,
  runtime: {
    raw: Buffer.byteLength(runtime),
    gzip: gzipSync(runtime, { level: 9 }).length,
  },
  finalHtml: Buffer.byteLength(html),
  finalHtmlGzip: gzipSync(html, { level: 9 }).length,
  sha256: createHash("sha256").update(html).digest("hex"),
};

const sizeReport = JSON.stringify(sizes, null, 2);
write("dist/sizes.json", sizeReport + "\n");

await run("tar", [
  "-czf",
  "dist/doom-source.tar.gz",
  "--exclude=.DS_Store",
  ".build/doomgeneric/doomgeneric",
  ".build/doomgeneric/LICENSE",
  ".build/doomgeneric/REVISION",
  ".build/doomgeneric/README.md",
  ".build/doomgeneric/README.TXT",
  "src",
  "scripts",
  "licenses",
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.ts",
  "tsconfig.json",
  "README.md",
  ".gitignore",
  ".oxlintrc.json",
  ".oxfmtrc.json",
]);

const seconds = (performance.now() - startedAt) / 1000;
const megabytes = sizes.finalHtml / 1_000_000;

console.log("\n" + pc.green(pc.bold("✓ Build complete")));
console.log(
  `  ${pc.dim("Toolchain")}    Emscripten ${sdkVersion} · ${wasmTarget} · Node ${process.version}`,
);
console.log(`  ${pc.dim("Build time")}   ${seconds.toFixed(1)}s`);
console.log(`  ${pc.dim("Build size")}   ${megabytes.toFixed(2)} MB`);
console.log(`  ${pc.dim("Output file")}  ${pc.cyan(outputFile)}`);

console.log(
  `\n${pc.cyan("→")} Drop ${pc.bold("doom.html")} into a Slack channel or DM to play.`,
);
