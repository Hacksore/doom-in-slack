import { readFileSync as read } from "node:fs";

export type Lump = { name: string; data: Buffer };

export function readWadName(data: Buffer, offset: number) {
  return data.toString("ascii", offset, offset + 8).replaceAll("\0", "");
}

export function trimVisuals(lumps: Lump[]) {
  function getLumpData(name: string) {
    const lump = lumps.find((entry) => entry.name === name);
    if (!lump) throw new Error(`Missing WAD lump: ${name}`);
    return lump.data;
  }

  const textures = new Set<string>(["SKY1", "SKY2", "SKY3", "SKY4"]);
  const flats = new Set<string>(["F_SKY1", "FLOOR4_8"]);
  const sides = getLumpData("SIDEDEFS");
  for (let offset = 0; offset < sides.length; offset += 30) {
    for (const field of [4, 12, 20]) {
      textures.add(readWadName(sides, offset + field));
    }
  }

  const sectors = getLumpData("SECTORS");
  for (let offset = 0; offset < sectors.length; offset += 26) {
    for (const field of [4, 12]) {
      flats.add(readWadName(sectors, offset + field));
    }
  }

  const switchSource = read(
    ".build/doomgeneric/doomgeneric/p_switch.c",
    "utf8",
  );
  for (const [, switchName] of switchSource.matchAll(/"(SW[12][^"]+)"/g)) {
    textures.add(switchName);
  }

  const anims = [
    ...read(".build/doomgeneric/doomgeneric/p_spec.c", "utf8").matchAll(
      /\{(true|false),\s*"([^"]+)",\s*"([^"]+)"/g,
    ),
  ];

  const textureLumps = lumps.filter((l) => /^TEXTURE[12]$/.test(l.name));
  const entries = new Map<string, Buffer>();
  for (const lump of textureLumps) {
    const b = lump.data;
    for (let i = 0; i < b.readInt32LE(0); i++) {
      const p = b.readInt32LE(4 + i * 4);
      const count = b.readInt16LE(p + 20);
      entries.set(readWadName(b, p), b.subarray(p, p + 22 + 10 * count));
    }
  }
  const textureNames = [...entries.keys()];
  const lumpNames = lumps.map((lump) => lump.name);

  for (const [, kind, endName, startName] of anims) {
    if (kind === "true") {
      addAnimationRange(textureNames, textures, startName, endName);
    } else {
      addAnimationRange(lumpNames, flats, startName, endName);
    }
  }

  const usedPatches = new Set<number>();
  const kept = [...entries].filter(([n]) => textures.has(n));
  for (const [, textureData] of kept) {
    for (let i = 0; i < textureData.readInt16LE(20); i++) {
      usedPatches.add(textureData.readUInt16LE(22 + i * 10 + 4));
    }
  }

  const pnames = getLumpData("PNAMES");
  const patchNames = new Set(
    [...usedPatches].map((index) => readWadName(pnames, 4 + index * 8)),
  );

  const directory = Buffer.alloc(4 + kept.length * 4);
  directory.writeInt32LE(kept.length, 0);
  let off = directory.length;
  kept.forEach(([, b], i) => {
    directory.writeInt32LE(off, 4 + i * 4);
    off += b.length;
  });
  const texture = Buffer.concat([directory, ...kept.map(([, b]) => b)]);
  const types = new Set<number>();
  const things = getLumpData("THINGS");
  for (let offset = 0; offset < things.length; offset += 10) {
    types.add(things.readUInt16LE(offset + 6));
  }

  const sprites = collectSpriteFamilies(types);

  let section = "";
  const result: Lump[] = [];
  for (const l of lumps) {
    if (/^[SPF]_START$/.test(l.name)) section = l.name[0];
    let keep = true;
    if (section === "S" && !l.name.startsWith("S_"))
      keep = sprites.has(l.name.slice(0, 4));
    if (section === "P" && !/^P\d?_/.test(l.name))
      keep = patchNames.has(l.name);
    if (section === "F" && !/^F\d?_/.test(l.name)) keep = flats.has(l.name);
    if (l.name === "TEXTURE1") {
      result.push({ name: l.name, data: texture });
      continue;
    }
    if (l.name === "TEXTURE2") continue;
    // Preserve menu/help/title and intermission assets; no finale is reachable.
    if (/^(VICTORY2|ENDPIC|BOSSBACK|PFUB[12]|END[0-6])$/.test(l.name))
      keep = false;
    if (keep) result.push(l);
    if (/^[SPF]_END$/.test(l.name)) section = "";
  }
  return {
    lumps: result,
    stats: {
      textures: kept.length,
      spriteFamilies: sprites.size,
      mapTypes: [...types].sort((a, b) => a - b),
    },
  };
}

function addAnimationRange(
  names: string[],
  used: Set<string>,
  startName: string,
  endName: string,
) {
  const first = names.indexOf(startName);
  const last = names.indexOf(endName);
  if (first < 0 || last < first) return;

  for (const name of names.slice(first, last + 1)) used.add(name);
}

function collectSpriteFamilies(types: Set<number>) {
  const info = read(".build/doomgeneric/doomgeneric/info.c", "utf8");
  const roots = new Set<string>();
  for (const m of info.matchAll(/\{\s*\/\/ (MT_\w+)\s+([\s\S]*?)\n\s*\}/g)) {
    const number = Number(m[2].match(/(-?\d+),\s*\/\/ doomednum/)?.[1]);
    if (
      number === -1 ||
      types.has(number) ||
      ["MT_CLIP", "MT_SHOTGUN", "MT_CHAINGUN"].includes(m[1])
    ) {
      for (const [state] of m[2].matchAll(/\bS_\w+/g)) roots.add(state);
    }
  }

  const states = new Map<string, { sprite: string; next: string }>();
  for (const m of info.matchAll(
    /\{SPR_(\w+),[^\n]+?\},(S_\w+),[^\n]+?\/\/ (S_\w+)/g,
  )) {
    states.set(m[3], { sprite: m[1], next: m[2] });
  }
  if (states.size < 900) throw Error("State parser failed");

  // All first-person weapon animations (including weapons acquired through cheat codes).
  const weaponSprites = info
    .slice(info.indexOf("char *sprnames"), info.indexOf("NULL"))
    .match(/"\w+"/g)!
    .slice(0, 16)
    .map((s) => s.slice(1, -1));
  const sprites = new Set(weaponSprites);
  const seen = new Set<string>();
  const visit = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    const st = states.get(s);
    if (st) {
      sprites.add(st.sprite);
      visit(st.next);
    }
  };
  for (const s of roots) visit(s);
  return sprites;
}
