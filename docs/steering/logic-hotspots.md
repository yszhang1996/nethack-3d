# Logic Hotspots Steering

Use this file when deciding where to implement a change.

## If You Need To Change Rendering
- Start in `src/game/Nethack3DEngine.ts` (`updateTile`).
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
- Runtime input staging and async resolver logic: `src/runtime/LocalNetHackRuntime.ts`.
- Key callbacks:
  - `shim_get_nh_event`
  - `shim_yn_function`
  - `shim_nh_poskey`
- Menu callbacks:
  - `shim_start_menu`
  - `shim_add_menu`
  - `shim_end_menu`
  - `shim_select_menu`

## If You Need To Change Inventory UX
- Runtime inventory updates/questions are produced in `shim_end_menu` handling for window 4 (`src/runtime/LocalNetHackRuntime.ts`).
- Engine inventory handling:
  - event handling: `inventory_update` case in `handleRuntimeEvent`
  - UI display: `updateInventoryDisplay`, `showInventoryDialog`

## If You Need To Change Stats/HUD
- Runtime status event and pointer decoding: `shim_status_update` (`src/runtime/LocalNetHackRuntime.ts`).
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
- If changing menus/input: confirm Esc, Enter, direction prompts, and inventory still work.
- If changing tile logic: verify player tracking and map refresh (`Ctrl+T`, `Ctrl+R`) still function.
- If changing status updates: verify numeric parsing and string fields do not regress.
