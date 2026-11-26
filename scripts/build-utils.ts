import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync as read,
  writeFileSync as write,
} from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { execa } from "execa";
import { minify } from "terser";

import { trimVisuals, type Lump } from "./trim-wad.ts";

export const run = execa({ stdio: "inherit" });

export async function prepareSources() {
  const doomRev = "e257a09527062bfb986b6e5e0780839b6cbd5b71";
  if (!existsSync(".build/doomgeneric/doomgeneric/Makefile")) {
    await run("git", [
      "clone",
      "https://github.com/ozkl/doomgeneric.git",
      ".build/doomgeneric",
    ]);
    await run("git", ["checkout", doomRev], { cwd: ".build/doomgeneric" });
  }

  let actualRevision: string;
  if (existsSync(".build/doomgeneric/.git")) {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: ".build/doomgeneric",
      stderr: "inherit",
    });
    actualRevision = stdout.trim();
  } else {
    actualRevision = read(".build/doomgeneric/REVISION", "utf8").trim();
  }

  if (actualRevision !== doomRev) {
    throw new Error(
      `Unexpected DoomGeneric revision ${actualRevision}, expected ${doomRev}`,
    );
  }

  write(".build/doomgeneric/REVISION", doomRev + "\n");

  if (!existsSync(".build/freedoom.zip")) {
    await run("curl", [
      "-fL",
      "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip",
      "-o",
      ".build/freedoom.zip",
    ]);
  }

  if (
    createHash("sha256").update(read(".build/freedoom.zip")).digest("hex") !==
    "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"
  ) {
    throw new Error("Freedoom checksum mismatch");
  }

  await run("unzip", [
    "-oq",
    ".build/freedoom.zip",
    "freedoom-0.13.0/freedoom1.wad",
    "freedoom-0.13.0/COPYING.txt",
    "freedoom-0.13.0/CREDITS.txt",
    "-d",
    ".build",
  ]);

  copyFileSync(".build/freedoom-0.13.0/COPYING.txt", "licenses/Freedoom.txt");
  copyFileSync(
    ".build/freedoom-0.13.0/CREDITS.txt",
    "licenses/Freedoom-CREDITS.txt",
  );
  copyFileSync(".build/doomgeneric/LICENSE", "licenses/DOOM.txt");

  const notices = [
    "DOOM engine (GPL-2.0-or-later), doomgeneric revision " + doomRev,
    read("licenses/DOOM.txt", "utf8"),
    read("licenses/Freedoom.txt", "utf8"),
    read("licenses/Freedoom-CREDITS.txt", "utf8"),
  ].join("\n\n");

  return { original: read(".build/freedoom-0.13.0/freedoom1.wad"), notices };
}

export function buildWad(original: Buffer) {
  const lumps = readFirstMapLumps(original);
  const conservative = encodeWad(lumps);
  const trimmed = trimVisuals(lumps);

  return {
    conservative,
    game: encodeWad(trimmed.lumps),
    trimStats: trimmed.stats,
  };
}

// Keep the first map and all visual assets. Drop audio, demos, and other maps.
function readFirstMapLumps(original: Buffer) {
  const lumps: Lump[] = [];
  let map = "";
  const directoryOffset = original.readInt32LE(8);

  for (let i = 0; i < original.readInt32LE(4); i++) {
    const entry = directoryOffset + i * 16;
    const start = original.readInt32LE(entry);
    const size = original.readInt32LE(entry + 4);
    const name = original
      .toString("ascii", entry + 8, entry + 16)
      .replace(/\0/g, "");
    if (/^E\dM\d$/.test(name)) map = name;
    else if (
      ![
        "THINGS",
        "LINEDEFS",
        "SIDEDEFS",
        "VERTEXES",
        "SEGS",
        "SSECTORS",
        "NODES",
        "SECTORS",
        "REJECT",
        "BLOCKMAP",
      ].includes(name)
    )
      map = "";

    if ((map && map !== "E1M1") || /^(DS|DP|DEMO)/.test(name)) continue;

    lumps.push({ name, data: original.subarray(start, start + size) });
  }
  return lumps;
}

function encodeWad(items: Lump[]) {
  let offset = 12;
  const dir = Buffer.alloc(items.length * 16);

  items.forEach((l, i) => {
    dir.writeInt32LE(offset, i * 16);
    dir.writeInt32LE(l.data.length, i * 16 + 4);
    dir.write(l.name, i * 16 + 8, 8, "ascii");
    offset += l.data.length;
  });

  const head = Buffer.alloc(12);
  head.write("IWAD");
  head.writeInt32LE(items.length, 4);
  head.writeInt32LE(offset, 8);
  return Buffer.concat([head, ...items.map((l) => l.data), dir]);
}

export async function compileEngine() {
  const make = read(".build/doomgeneric/doomgeneric/Makefile", "utf8");
  const sourceList = make.match(/SRC_DOOM = (.*)/)?.[1];
  if (!sourceList)
    throw new Error("Could not read DoomGeneric sources from Makefile");

  const sources = sourceList
    .trim()
    .split(/\s+/)
    .filter((x) => x !== "doomgeneric_xlib.o")
    .map((x) =>
      resolve(".build/doomgeneric/doomgeneric", x.replace(/\.o$/, ".c")),
    );

  // This one-map POC always restarts E1M1 after intermission or New Game.
  let gameSource = read(".build/doomgeneric/doomgeneric/g_game.c", "utf8");

  for (const [from, to] of [
    ["gamemap = wminfo.next+1;", "gamemap = 1; gameepisode = 1;"],
    ["gamemap = map;", "gamemap = 1; gameepisode = 1;"],
  ]) {
    if (!gameSource.includes(from))
      throw Error("Upstream map patch no longer applies");
    gameSource = gameSource.replace(from, to);
  }

  write(".build/g_game.c", gameSource);
  const gameSourceIndex = sources.indexOf(
    resolve(".build/doomgeneric/doomgeneric/g_game.c"),
  );
  if (gameSourceIndex === -1)
    throw new Error("g_game.c is missing from the DoomGeneric sources");

  sources[gameSourceIndex] = resolve(".build/g_game.c");

  const emcc =
    process.env.EMCC || resolve(".build/emsdk/upstream/emscripten/emcc");
  await run(emcc, [
    ...sources,
    resolve("src/platform.c"),
    "-I" + resolve(".build/doomgeneric/doomgeneric"),
    "-Oz",
    "-flto",
    "-DNORMALUNIX",
    "-DLINUX",
    "-D_DEFAULT_SOURCE",
    "-DDOOMGENERIC_RESX=320",
    "-DDOOMGENERIC_RESY=200",
    "-sENVIRONMENT=web",
    "-sDYNAMIC_EXECUTION=0",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createDoom",
    "-sFILESYSTEM=1",
    "-sFORCE_FILESYSTEM=1",
    '-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]',
    '-sEXPORTED_FUNCTIONS=["_main","_key_event"]',
    "-sINVOKE_RUN=0",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sINITIAL_MEMORY=33554432",
    "-sASYNCIFY=1",
    "-sASSERTIONS=0",
    "-sEXIT_RUNTIME=0",
    "-o",
    resolve(".build/engine.js"),
  ]);
  return read(".build/engine.js", "utf8");
}

export function encodePayload(bytes: Buffer) {
  const compressed = gzipSync(bytes, { level: 9 });
  const encoded = compressed.toString("base64");

  return {
    encoded,
    sizes: {
      raw: bytes.length,
      gzip: compressed.length,
      base64: Buffer.byteLength(encoded),
    },
  };
}

export function renderGameHtml(
  runtime: string,
  wasm: string,
  wad: string,
  notices: string,
) {
  const html = read("src/shell.html", "utf8")
    .replace(
      /<link rel="stylesheet" href="\/src\/doom\.css"\s*\/?>/,
      () => "<style>" + read("src/doom.css", "utf8").trim() + "</style>",
    )
    .replace("/*ENGINE*/", () => runtime)
    .replace("__WASM__", wasm)
    .replace("__WAD__", wad)
    .replace("__NOTICES__", () =>
      notices.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    );
  return minifyInlineScript(html, "src/shell.html");
}

async function minifyInlineScript(html: string, source: string) {
  const scriptPattern = /<script>([\s\S]*?)<\/script>/;
  const script = html.match(scriptPattern)?.[1];
  if (!script) throw new Error(`Missing inline script in ${source}`);

  const { code } = await minify(script, {
    compress: true,
    mangle: true,
    format: { comments: false, inline_script: true },
  });
  if (!code) throw new Error(`Minification failed for ${source}`);
  return html.replace(scriptPattern, () => `<script>${code}</script>`);
}
