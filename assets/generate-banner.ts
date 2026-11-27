// Run with node assets/generate-banner.ts. Requires ImageMagick 7 on PATH.
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

const output = join(import.meta.dirname, "play-doom-in-slack.gif");
// Keep the banner at 50 fps; change the pulse duration to adjust its speed.
const framesPerSecond = 50;
const pulseSeconds = 0.8;
const frameCount = Math.round(pulseSeconds * framesPerSecond);

const macFont = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const font = existsSync(macFont) ? macFont : "DejaVu-Sans-Bold";
const work = mkdtempSync(join(import.meta.dirname, ".banner-"));

try {
  const frames: string[] = [];

  for (let index = 0; index < frameCount; index++) {
    const phase = (index * 2 * Math.PI) / frameCount;
    const scale = 1.05 - 0.15 * Math.cos(phase);
    const frame = join(work, `${index}.png`);

    await execa("magick", [
      "-size",
      "410x144",
      "xc:#000000",
      "-draw",
      `translate 62,72 scale ${scale},${scale}
       fill '#db4f30' roundrectangle -24,-24 24,24 10,10
       fill none stroke white stroke-width 3 stroke-linecap round stroke-linejoin round
       path 'M -9,-5 L -14,0 L -9,5 M 3,-8 L -3,8 M 9,-5 L 14,0 L 9,5'`,
      "-fill",
      "#fff1dd",
      "-font",
      font,
      "-pointsize",
      "23",
      "-annotate",
      "+108+55",
      "Open doom.html to",
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
