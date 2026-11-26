// Run with node assets/generate-banner.ts. Requires ImageMagick 7 on PATH.
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

const output = join(import.meta.dirname, "play-doom-in-slack.gif");
const framesPerSecond = 50;
const bounceSeconds = 1.44 / 2.5;
// Five bounces take exactly 144 frames at 50 fps, keeping the loop seamless.
const bouncesPerLoop = 5;
const frameCount = Math.round(bounceSeconds * bouncesPerLoop * framesPerSecond);
const arrow = [
  [33, 50],
  [62, 79],
  [91, 50],
  [82, 41],
  [69, 54],
  [69, 21],
  [55, 21],
  [55, 54],
  [42, 41],
] as const;

const macFont = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const font = existsSync(macFont) ? macFont : "DejaVu-Sans-Bold";
const work = mkdtempSync(join(import.meta.dirname, ".banner-"));

try {
  const frames: string[] = [];

  for (let index = 0; index < frameCount; index++) {
    const phase = (index * bouncesPerLoop * 2 * Math.PI) / frameCount;
    const offset = 5 * (1 - Math.cos(phase));
    const points = arrow.map(([x, y]) => `${x},${y + 15 + offset}`).join(" ");
    const frame = join(work, `${index}.png`);

    await execa("magick", [
      "-size",
      "410x144",
      "xc:#201c1b",
      "-fill",
      "#ff784b",
      "-draw",
      `polygon ${points}`,
      "-fill",
      "#fff1dd",
      "-font",
      font,
      "-pointsize",
      "23",
      "-annotate",
      "+108+55",
      "Click to",
      "-pointsize",
      "46",
      "-annotate",
      "+105+105",
      "Play",
      "-fill",
      "#ff784b",
      "-annotate",
      "+214+105",
      "DOOM",
      frame,
    ]);
    frames.push(frame);
  }

  const gif = join(work, "banner.gif");
  await execa("magick", [
    "-delay",
    String(100 / framesPerSecond),
    ...frames,
    "-loop",
    "0",
    "-layers",
    "Optimize",
    gif,
  ]);
  renameSync(gif, output);
  console.log(output);
} finally {
  rmSync(work, { recursive: true, force: true });
}
