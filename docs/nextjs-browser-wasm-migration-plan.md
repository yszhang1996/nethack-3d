# Browser WASM Runtime Notes

## Current Runtime Shape

- NetHack WASM runs in `src/runtime/runtime-worker.ts` (Web Worker).
- Worker hosts `LocalNetHackRuntime` (`src/runtime/LocalNetHackRuntime.ts`).
- Main thread uses `WorkerRuntimeBridge` (`src/runtime/WorkerRuntimeBridge.ts`).
- 3D/UI logic runs in `src/game/Nethack3DEngine.ts`.

## Loading Model

- Runtime factory is loaded from `public/nethack.js`.
- WASM binary is loaded from `public/nethack-367.wasm`.
- Worker bundle is `public/runtime-worker.js`.
- App bundle is `public/app.js`.

## Message Contracts

- Engine -> Worker commands are typed in `src/runtime/types.ts` as `RuntimeCommand`.
- Worker -> Engine events are typed in `src/runtime/types.ts` as `RuntimeWorkerEnvelope`.
- Runtime payloads are represented as `RuntimeEvent`.

## Current Priorities

1. Preserve gameplay parity in async input/menu callbacks.
2. Keep worker/main-thread protocol stable.
3. Improve runtime typing coverage and remove `@ts-nocheck` from runtime core.
4. Add persistence strategy for runtime state/save data.
