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
- If adding/changing runtime event payloads, update both:
  - event emitter sites in `src/runtime/LocalNetHackRuntime.ts`
  - event handling in `src/game/Nethack3DEngine.ts`
- Keep menu/input async behavior stable in runtime state handling:
  - `waitingForInput`, `waitingForMenuSelection`, `waitingForPosition`
- Validate rendering-impact changes by checking:
  - player position updates
  - tile refresh commands
  - question dialogs (including direction and inventory flows)

## Do not run the build
- The user will run the build and validate all went well.