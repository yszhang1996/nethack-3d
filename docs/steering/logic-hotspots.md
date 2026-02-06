# Logic Hotspots Steering

Use this file when deciding where to implement a change.

## If You Need To Change Rendering
- Start in `src/app.ts:721` (`updateTile`).
- Material palette and shared geometries are near top of class (`src/app.ts` class fields).
- Glyph overlays and text painting path:
- `ensureGlyphOverlay` (`src/app.ts:532`)
- `createGlyphTexture` (`src/app.ts:562`)
- `applyGlyphMaterial` (`src/app.ts:600`)

## If You Need To Change WebSocket Message Behavior
- Server emit points are mostly inside `handleUICallback` in `server.js:390`.
- Client receive and dispatch is `handleServerMessage` in `src/app.ts:278`.
- Add/update message types on both ends in one commit.

## If You Need To Change Input Or Menus
- Browser key mapping and question gating: `src/app.ts:1978`.
- Server input staging and async resolver logic: `server.js:40` and callback cases:
- `shim_get_nh_event` (`server.js:398`)
- `shim_yn_function` (`server.js:418`)
- `shim_nh_poskey` (`server.js:476`)
- Menu callbacks:
- `shim_start_menu` (`server.js:520`)
- `shim_add_menu` (`server.js:754`)
- `shim_end_menu` (`server.js:552`)
- `shim_select_menu` (`server.js:1024`)

## If You Need To Change Inventory UX
- Server inventory updates/questions are produced in `shim_end_menu` handling for window 4 (`server.js:552`).
- Client inventory handling:
- Message handling: `src/app.ts:382` (`inventory_update` case)
- UI display: `updateInventoryDisplay` (`src/app.ts:1183`), `showInventoryDialog` (`src/app.ts:1456`)

## If You Need To Change Stats/HUD
- Server status event and pointer decoding: `shim_status_update` (`server.js:1227`).
- Client field mapping/parsing: `updatePlayerStats` (`src/app.ts:931`).
- Rendering HUD bar: `updateStatsDisplay` (`src/app.ts:1058`).

## If You Need To Change Camera/Controls
- Keyboard movement mappings and dialog-aware suppression: `src/app.ts:1978`.
- Mouse zoom/rotate/pan handlers: `src/app.ts:2283` onward.
- Camera transform calculation: `updateCamera` (`src/app.ts:2253`).

## If You Need To Change Level Transition Behavior
- Server triggers clear on map window reset: `shim_clear_nhwindow` (`server.js:1183`).
- Client clear path: `clearScene` (`src/app.ts:703`) and `clear_scene` message case (`src/app.ts:444`).

## Sanity Checklist For Agents
- If changing protocol: verify both `server.js` and `src/app.ts` compile logically.
- If changing menus/input: confirm Esc, Enter, direction prompts, and inventory still work.
- If changing tile logic: verify player tracking and map refresh (`Ctrl+T`, `Ctrl+R`) still function.
- If changing status updates: verify numeric parsing and string fields do not regress.
