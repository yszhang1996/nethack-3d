# Logic Hotspots Steering

Use this file when deciding where to implement a change.
Detailed movement/cursor flow reference: `docs/steering/movement-flow.md`.

## If You Need To Change Rendering

- Start in `src/game/Nethack3DEngine.ts` (`updateTile`).
- Glyph resolution/classification source-of-truth is in:
  - `src/game/glyphs/registry.ts`
  - `src/game/glyphs/behavior.ts`
  - `src/game/glyphs/glyph-catalog.367.generated.ts` (generated)
- Material palette and shared geometries are near top of class fields.
- Glyph overlays and text painting path:
- `ensureGlyphOverlay`
- `createGlyphTexture`
- `applyGlyphMaterial`

## If You Need To Change Runtime Event Behavior

- Runtime event emit points are in `src/runtime/LocalNetHackRuntime.ts` (`emit(...)` sites, mostly inside `handleUICallback`).
- Engine receive and dispatch is `handleRuntimeEvent` in `src/game/Nethack3DEngine.ts`.
- Add/update event payloads in runtime + engine in one commit.

## If You Need To Change Input Or Menus

- Browser key mapping and question gating: `src/game/Nethack3DEngine.ts` (`handleKeyDown`).
- Runtime input broker implementation: `src/runtime/input/RuntimeInputBroker.ts`.
- Runtime key normalization + enqueue path: `handleClientInput` in `src/runtime/LocalNetHackRuntime.ts`.
- Runtime consume path: `requestInputCode`, `consumeInputResult` in `src/runtime/LocalNetHackRuntime.ts`.
- Runtime callback-kind token targeting (`targetKinds`) should be preserved for
  synthetic/meta/menu key sequences.
- Key callbacks:
  - `handleShimGetNhEvent`
  - `handleShimYnFunction`
  - `handleShimNhPoskey`
- Menu callbacks:
  - `shim_start_menu`
  - `shim_add_menu`
  - `shim_end_menu`
  - `shim_select_menu`
- Menu waiter isolation state:
  - `pendingMenuSelection`
  - `menuSelectionReadyCount`
- Position/far-look state:
  - `farLookMode` (`none | armed | active`)
  - `position_input_state` / `position_cursor` emit paths

## If You Need To Change Inventory UX

- Runtime inventory updates/questions are produced in `shim_end_menu` handling for window 4 (`src/runtime/LocalNetHackRuntime.ts`).
- Engine inventory handling:
  - event handling: `inventory_update` case in `handleRuntimeEvent`
  - UI display: `updateInventoryDisplay`, `showInventoryDialog`

## If You Need To Change Stats/HUD

- Runtime status decode and flush batching:
  - `shim_status_update`
  - `flushPendingStatusUpdates`
  - `statusPending` / `latestStatusUpdates`
- Engine field mapping/parsing: `updatePlayerStats`.
- Rendering HUD bar: `updateStatsDisplay`.

## If You Need To Change Camera/Controls

- Keyboard movement mappings and dialog-aware suppression: `src/game/Nethack3DEngine.ts` (`handleKeyDown`).
- Mouse zoom/rotate/pan handlers: `src/game/Nethack3DEngine.ts` mouse handlers.
- Camera transform calculation: `updateCamera`.

## If You Need To Change Level Transition Behavior

- Runtime triggers clear on map window reset: `shim_clear_nhwindow` (`src/runtime/LocalNetHackRuntime.ts`).
- Engine clear path: `clearScene` and `clear_scene` event case in `handleRuntimeEvent`.

## Sanity Checklist For Agents

- If changing worker protocol: verify both `src/runtime/*` and `src/game/*` compile logically.
- If changing runtime artifacts (`public/nethack.js` or `public/nethack-367.wasm`): run `npm run glyphs:generate` and commit updated generated catalog.
- If changing menus/input: confirm Esc/Enter flow, direction prompts, inventory selection, and far-look transitions still work.
- If changing broker behavior: ensure no callback bypasses `requestInputCode(...)` for key-consuming waits.
- If changing tile logic: verify player tracking and map refresh (`Ctrl+T`, `Ctrl+R`) still function.
- If changing status updates: verify flush-trigger emission ordering and reconnect snapshot consistency.
