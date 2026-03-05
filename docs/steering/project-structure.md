# Project Structure Steering

## Related Steering Docs

- Input and player/cursor movement pipeline: `docs/steering/movement-flow.md`.
- Edit hotspots and change playbook: `docs/steering/logic-hotspots.md`.

## Top-Level Layout

- `index.html`: Vite HTML entry.
- `src/main.tsx`: React app entry.
- `src/ui/App.tsx`: React UI shell (hooks + Zustand).
- `src/app.ts`: debug helper registration.
- `src/game/Nethack3DEngine.ts`: browser-side 3D engine and UI controller.
- `src/audio/FmodRuntime.ts`: FMOD Studio HTML5/WASM bootstrap + runtime wrapper.
- `src/game/glyphs/behavior.ts`: centralized glyph-to-render behavior rules.
- `src/game/glyphs/registry.ts`: glyph catalog lookup/resolution helpers.
- `src/game/glyphs/glyph-catalog.generated.ts`: checked-in glyph source-of-truth generated from runtime.
- `src/runtime/LocalNetHackRuntime.ts`: NetHack callback adapter/state machine.
- `src/runtime/runtime-worker.ts`: worker entrypoint that hosts runtime.
- `src/runtime/WorkerRuntimeBridge.ts`: main-thread bridge to worker.
- `src/runtime/factory-loader.ts`: loads `public/nethack.js` factory in main/worker contexts.
- `scripts/glyphs/generate-glyph-catalog.mjs`: regenerates glyph catalog from runtime artifacts.
- `scripts/glyphs/check-glyph-catalog.mjs`: verifies catalog is not stale.
- `public/nethack.js`, `public/nethack-367.wasm`: NetHack runtime artifacts.
- `package.json`: build/start scripts.

## Build And Run

- Install deps: `npm i`.
- Check glyph catalog freshness: `npm run glyphs:check`.
- Regenerate glyph catalog when runtime changes: `npm run glyphs:generate`.
- Start dev host: `npm run dev`.
- Build bundles: `npm run build`.
- Preview production build: `npm run preview`.

## Runtime Architecture

1. `src/main.tsx` mounts React and creates `Nethack3DEngine`.
2. Engine creates `WorkerRuntimeBridge`.
3. Bridge starts `public/runtime-worker.js`.
4. Worker creates `LocalNetHackRuntime`.
5. Runtime loads NetHack factory from `public/nethack.js`, then boots `public/nethack-367.wasm`.
6. NetHack shim callbacks route through `handleUICallback` and emit runtime events.
7. Worker forwards runtime events to the engine for rendering/UI updates.

## Runtime Logic Map (`src/runtime/LocalNetHackRuntime.ts`)

- Input intake from engine: `sendInput`, `handleClientInput`.
- Tile refresh APIs: `requestTileUpdate`, `requestAreaUpdate`.
- Key translation helper: `processKey`.
- NetHack lifecycle + wasm config: `initializeNetHack`.
- NetHack callback switchboard: `handleUICallback`.

### Callback Groups

- Input blocking/async waits: `shim_get_nh_event`, `shim_yn_function`, `shim_nh_poskey`.
- Menu lifecycle: `shim_start_menu`, `shim_add_menu`, `shim_end_menu`, `shim_select_menu`.
- Rendering feed: `shim_print_glyph`.
- Messaging feed: `shim_putstr`, `shim_raw_print`.
- Player position + level transitions: `shim_cliparound`, `shim_clear_nhwindow`.
- Status propagation: `shim_status_update`.

## Engine Logic Map (`src/game/Nethack3DEngine.ts`)

- Engine setup: constructor + `initThreeJS`.
- Runtime startup: `connectToRuntime`.
- Runtime event dispatcher: `handleRuntimeEvent`.
- Tile state + rendering decisions: `updateTile`.
- HUD/status parsing: `updatePlayerStats`, `updateStatsDisplay`.
- Dialog systems: `showQuestion`, `showDirectionQuestion`, `showInventoryDialog`.
- Keyboard control path: `handleKeyDown`.
- Camera path: `updateCamera`, mouse handlers.

## Runtime Event Contract (Worker -> Engine)

- Map/data: `map_glyph`, `map_glyph_batch`, `player_position`, `tile_not_found`, `area_refresh_complete`, `clear_scene`.
- Text/UI: `text`, `raw_print`, `question`, `direction_question`, `position_request`, `name_request`, `inventory_update`, `info_menu`.
- Player stats: `status_update`.

## Runtime Command Contract (Engine -> Worker)

- `send_input`
- `request_tile_update`
- `request_area_update`

## High-Risk Zones

- Async input state in runtime (`waitingForInput`, `waitingForPosition`, `waitingForMenuSelection`).
- Multi-pickup flow (`isInMultiPickup`, `menuSelections`, selection confirmation).
- Tile classification in `src/game/glyphs/behavior.ts` and `updateTile` orchestration.
- Question/dialog state flags (`isInQuestion`, `isInDirectionQuestion`) and escape handling.
