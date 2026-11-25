# DOOM in a Slack iframe: proof of concept

A self-contained DOOM engine running Freedoom Phase 1's first level. All generated outputs are in **`dist/`**, which is gitignored. Downloaded sources, compiler, intermediate binaries, screenshots and verification logs are in gitignored `.build/`.

## Build and run

Requires Node.js 24+, pnpm, Git, Python 3, curl, unzip and tar on macOS/Linux. The first build needs Internet access and approximately 2–3 GB for the local Emscripten SDK. The finished HTML needs neither a server nor Internet access.

```sh
pnpm install --frozen-lockfile
pnpm setup       # pinned Emscripten 4.0.20, installed only in .build/
pnpm build       # downloads and verifies Freedoom, compiles, trims, packages
open dist/doom.html # macOS; open this file in a modern browser elsewhere
```

The game starts automatically when the HTML loads. Click the canvas if the iframe needs keyboard focus. Arrows move/turn, Control or F fires, Space uses doors, Shift runs, Alt strafes, 1–7 select weapons, Escape opens the menu. Click the canvas again if focus leaves it. No pointer lock or audio permission is needed.

`EMCC=/absolute/path/to/emcc pnpm build` overrides the compiler location; use Emscripten 4.0.20 for matching results. Node's zlib and the pinned Terser version determine compression/minification. Dependency versions are locked in `pnpm-lock.yaml`.

Outputs:

- `dist/doom.html`: standalone playable file; copy this file alone to run offline.
- `dist/test.html`: approximately 2 KB, independent compatibility probe suitable for testing Slack's iframe. Reports inline script execution, origin, canvas readback, native gzip, WASM compilation and real key events. The optional local-test button loads the adjacent `doom.html` in an iframe with **only** `sandbox="allow-scripts"`.
- `dist/sizes.json`: exact byte sizes and final HTML SHA-256.
- `dist/doom-source.tar.gz`: corresponding engine source, platform adapter, build scripts and licenses for distribution with the GPL engine.

## Local development

Run `pnpm dev` and open the URL Vite prints. Run `pnpm setup` and `pnpm build` once first to generate the engine and WAD in `.build/`. Vite updates `src/doom.css` without restarting the game. Edits to `src/shell.html` reload the page. Rebuild and restart Vite after engine or WAD changes.

The dev page uses Vite’s local HMR connection. Use `pnpm build` to generate the offline, CSP-restricted artifact in `dist/`.

## Browser verification

```sh
pnpm verify
# On Linux or another Chrome installation:
CHROME=/path/to/chrome pnpm verify
```

Verification uses Playwright with the installed Google Chrome binary (default macOS path), an offline browser context and a local `file:` URL. It creates an opaque-origin iframe, verifies startup without clicking or pressing a key inside the game, checks actual player coordinates change after keyboard input, checks rendered frames, records page errors and HTTP requests, and confirms the WASM-denied diagnostic when `wasm-unsafe-eval` is removed. Reports and a screenshot are written to `.build/verification.json` and `.build/sandbox.png`. Browser automation is a development dependency only.

Validated locally in Chrome with `sandbox="allow-scripts"`, origin `null`, cross-origin isolation disabled and no runtime HTTP requests. This validates a simulated restrictive sandbox; actual Slack rendering, sanitization, payload limits, iframe permissions and CSP remain unverified.

## Implementation and CSP

The build investigated [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) at revision `65e0d3ae2ffa604155eebd96ed40da6567bd08f4`. Its Chocolate Doom/SDL and WebSocket-oriented configuration adds dependencies this silent, offline POC does not need. Instead, [doomgeneric](https://github.com/ozkl/doomgeneric) is compiled at pinned revision `e257a09527062bfb986b6e5e0780839b6cbd5b71`, with a small C adapter that sends pixels to Canvas 2D and queues keyboard events. Emscripten uses `-Oz`, LTO, Asyncify for cooperative sleeps, 320×200 rendering and `DYNAMIC_EXECUTION=0`. Game state and WAD files use Emscripten's in-memory filesystem; nothing requires localStorage, IndexedDB or persistent storage.

WASM and WAD are gzip level 9 compressed and Base64 encoded in the inline script. Native `DecompressionStream('gzip')` restores them from an in-memory Blob stream. **No blob URLs** are created. The minified Emscripten runtime is inline JavaScript. `wasmBinary` supplies all WASM bytes before initialization; WAD bytes are written to MEMFS before `callMain`. Emscripten's unused network-loading branches remain in its generic runtime, but this entry point never calls them, and the artifact prohibits connections via CSP.

The embedded CSP is:

```text
default-src 'none';
script-src 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'unsafe-inline';
connect-src 'none';
worker-src 'none';
base-uri 'none';
form-action 'none'
```

The parent must permit inline execution (or an equivalent matching hash/nonce policy), WASM compilation, keyboard focus and canvas rendering. Inline styles provide layout. No same-origin sandbox permission, workers, service workers, SharedArrayBuffer, CDN, external runtime script, dynamic import, eval, new Function, pointer lock, network or storage access is used. WebAssembly does not require JavaScript `unsafe-eval`; the narrower `wasm-unsafe-eval` permission is sufficient in the tested browser. See [Emscripten's DYNAMIC_EXECUTION setting](https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution).

An iframe's meta CSP can only restrict its policy, not relax a stricter host policy. If Slack disallows inline scripts entirely, the initial static message remains; code cannot diagnose its own refusal to execute. If Slack permits scripts but blocks WASM compilation, the compatibility check explains the failure before game startup.

An asm.js fallback would require a separate legacy Emscripten build and larger payload; an interpreter in JavaScript would add substantial complexity. Neither is implemented because the tested sandbox runs WASM. Actual Slack CSP measurements must determine whether a fallback is necessary or useful. A fallback would still need permission to execute inline JavaScript.

## Size and first-level packaging

Exact measured bytes from the current build (see `dist/sizes.json`):

| Payload | Raw | Gzip | Base64 |
| --- | ---: | ---: | ---: |
| WASM | 457,558 | 192,510 | 256,680 |
| First-level WAD | 5,902,337 | 1,835,319 | 2,447,092 |
| Emscripten JS before final minification | 70,270 | 19,372 | not encoded |

The final minified HTML is approximately **2,786,530 bytes (2.79 MB / 2.66 MiB)** including inline licenses/credits. Its gzip transfer size is 2,064,062 bytes (2.06 MB); that transfer compression does not make the actual file smaller for a host's embed size limit. The aspirational **under 1 MB target is not met**.

The original Freedoom IWAD is 28,795,076 bytes. Removing other maps, sound effects and demos while retaining all graphics yields 16,734,868 bytes (5,604,484 gzip). Dependency trimming reduces that to the WAD size above. It retains complete sprite families for first-map actors, weapons, dropped items and engine-spawned effects; sidedef textures; required texture patches; animation ranges; switch pairs; map flats; UI and intermission graphics. Unused ending art is removed; title, menu and help art is retained. Music lumps remain because this engine looks them up even with its audio backend disabled.

The engine's level-selection paths are patched at build time to select E1M1, including restart after intermission, so removed maps are never required through normal progression or New Game. All visual dependencies needed by the retained map are preserved conservatively; this is not a general-purpose WAD minimizer. Further large reductions would require deliberately lower-detail replacement assets, a smaller replacement map, or more aggressive runtime-aware asset pruning. Those changes are outside this POC.

## Assets, source and limitations

[Freedoom 0.13.0](https://github.com/freedoom/freedoom/releases/tag/v0.13.0) provides freely redistributable replacement assets under its BSD-style license. The release archive is verified against SHA-256 `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`. No commercial Doom WAD or modified shareware WAD is redistributed. The game is the DOOM engine with Freedoom art and level design, rather than id Software's original campaign.

Engine code is GPL-2.0-or-later. Full license notices and Freedoom credits are embedded in the playable file and copied into `licenses/`. Preserve them and distribute the corresponding source archive with binary releases. Extract that archive, run `pnpm install --frozen-lockfile`, `pnpm setup`, then `pnpm build` to rebuild; assets are fetched from the pinned, checksummed release.

Only E1M1 is packaged. Silent audio, ephemeral configuration/saves, keyboard-only input, no networking and no Slack application integration. Menu options inherited from DOOM may offer unavailable functionality. Compatibility probing is not evidence that a Slack surface supports arbitrary HTML embeds. Gameplay startup, movement, rendering and menu access are tested; the entire level has not been manually played to completion.
