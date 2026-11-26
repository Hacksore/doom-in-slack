import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync as read,
  writeFileSync as write,
} from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  buildWad,
  compileEngine,
  encodePayload,
  prepareSources,
  renderGameHtml,
  run,
} from "./build-utils.ts";

process.chdir(resolve(import.meta.dirname, ".."));

mkdirSync(".build", { recursive: true });
mkdirSync("licenses", { recursive: true });
mkdirSync("dist", { recursive: true });

const { original, notices } = await prepareSources();

const { conservative, game, trimStats } = buildWad(original);

write(".build/doom1.wad", game);

const runtime = await compileEngine();
if (/\beval\s*\(|new Function\s*\(/.test(runtime)) {
  throw new Error("Dynamic execution in generated runtime");
}

const wasm = encodePayload(read(".build/engine.wasm"));
const wad = encodePayload(game);

const html = await renderGameHtml(runtime, wasm.encoded, wad.encoded, notices);
write("dist/doom.html", html);

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
console.log(sizeReport);

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
