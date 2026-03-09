# Agent Steering

Start here before making changes.

## Project Summary

- NetHack 3D is a browser-first JavaScript/TypeScript app.
- `src/game/Nethack3DEngine.ts` renders the map with Three.js and owns UI/input behavior.
- `src/runtime/runtime-worker.ts` runs the NetHack WASM runtime in a dedicated Web Worker.
- `src/runtime/LocalNetHackRuntime.ts` is the runtime callback adapter used inside the worker.
- `src/runtime/WorkerRuntimeBridge.ts` bridges game input/events between the main thread and worker.
- `public/index.html` provides the static shell and mount points for overlays.

## Core Runtime Paths

- App bootstrap: `src/app.ts`.
- Main 3D engine: `src/game/Nethack3DEngine.ts`.
- Runtime worker entry: `src/runtime/runtime-worker.ts`.
- Runtime callback bridge: `src/runtime/LocalNetHackRuntime.ts` (`handleUICallback`).
- Worker bridge: `src/runtime/WorkerRuntimeBridge.ts`.
- Runtime message typing: `src/runtime/types.ts`.

## Steering Documents

- Architecture and file map: `docs/steering/project-structure.md`
- Logic hotspots and edit playbook: `docs/steering/logic-hotspots.md`

## Working Rules For Agents

- Treat `src/game/*` and `src/runtime/*` as source of truth.
- `public/app.js` and `public/runtime-worker.js` are build outputs.
- Prefer adding new gameplay/runtime features in focused files under `src/game/*` or `src/runtime/*` by function (input, audio, rendering, parsing, UI state, etc.) rather than adding large new blocks to `src/game/Nethack3DEngine.ts`.
- Keep `src/game/Nethack3DEngine.ts` as an orchestration layer when possible: wire modules together there, but move new domain logic into separate modules to support gradual migration away from the monolithic file.
- Use React components whenever possible to avoid duplicated code and keep the code and CSS clean and concise. The goal is DRY code.
  - If refactoring to make code DRY is needed, suggest it to the user, or do it if it's within the scope of the task you're handling.
  - Store components in logical subfolders and not a dumping ground in the UI folder. Prefer grouped sections for folders than many individual folders.
  - If you see a common theme that nearly fits a folder, but not quite, renaming a component folder to keep things organized and clean is fine.
- If adding/changing runtime event payloads, update both:
  - event emitter sites in `src/runtime/LocalNetHackRuntime.ts`
  - event handling in `src/game/Nethack3DEngine.ts`
- Keep menu/input async behavior stable in runtime state handling:
  - `waitingForInput`, `waitingForMenuSelection`, `waitingForPosition`
- Validate rendering-impact changes by checking:
  - player position updates
  - tile refresh commands
  - question dialogs (including direction and inventory flows)

## Reference NetHack for information about shims and NetHack game behavior

- The NetHack source code in `third_party/nethack-3.6.7` is the pinned commit that the WASM is compiled from, so it can be considered the source of truth.
- If it's not found, the offical NetHack git is here: https://github.com/NetHack/NetHack.
- Never modify the NetHack source code. In all cases, we need to work with what NetHack gives us. If changes are not avoidable, let the user know.

## Do not run the build

- The user will run the build and validate all went well.
