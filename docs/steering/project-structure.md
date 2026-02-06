# Project Structure Steering

## Top-Level Layout
- `server.js`: Node runtime for static hosting, WebSocket server, NetHack WASM session management, and callback bridge.
- `src/app.ts`: Browser-side 3D engine and UI controller.
- `public/index.html`: Static UI shell and module bootstrap.
- `public/nethack.js`, `public/nethack.wasm`: NetHack runtime artifacts loaded by server.
- `public/three.module.js`, `public/three.core.js`: vendored Three.js runtime.
- `public/app.js`: built bundle from `src/app.ts`.
- `package.json`: build/start scripts.

## Build And Run
- Build client bundle: `npm run build`.
- Start server: `npm start`.
- Build command definition: `package.json` script `build`.

## Runtime Architecture
1. HTTP + WebSocket server starts in `server.js` (`server.js:1311`, `server.js:1356`).
2. New socket creates a dedicated `NetHackSession` (`server.js:7`, `server.js:1359`).
3. Session initializes NetHack WASM and registers `globalThis.nethackCallback` (`server.js:278`).
4. NetHack shim callbacks route through `handleUICallback` (`server.js:390`).
5. Server emits protocol messages (`map_glyph`, `question`, `status_update`, etc.) to browser over WebSocket.
6. Browser `Nethack3DEngine` receives messages and updates scene/UI (`src/app.ts:278`).

## Server Logic Map (`server.js`)
- Input intake from browser: `handleClientInput` (`server.js:40`).
- Tile refresh APIs for client debug shortcuts: `handleTileUpdateRequest` (`server.js:170`), `handleAreaUpdateRequest` (`server.js:213`).
- Key translation helper: `processKey` (`server.js:267`).
- NetHack lifecycle + wasm config: `initializeNetHack` (`server.js:278`).
- NetHack callback switchboard: `handleUICallback` (`server.js:390`).

### Callback Groups
- Input blocking/async waits: `shim_get_nh_event`, `shim_yn_function`, `shim_nh_poskey`.
- Menu lifecycle: `shim_start_menu`, `shim_add_menu`, `shim_end_menu`, `shim_select_menu`.
- Rendering feed: `shim_print_glyph`.
- Messaging feed: `shim_putstr`, `shim_raw_print`.
- Player position + level transitions: `shim_cliparound`, `shim_clear_nhwindow`.
- Status propagation: `shim_status_update`.

## Client Logic Map (`src/app.ts`)
- Engine setup: constructor + `initThreeJS` (`src/app.ts:122`, `src/app.ts:137`).
- Connection and reconnect: `connectToServer` (`src/app.ts:215`).
- Server protocol dispatcher: `handleServerMessage` (`src/app.ts:278`).
- Tile state + rendering decisions: `updateTile` (`src/app.ts:721`).
- HUD/status parsing: `updatePlayerStats`, `updateStatsDisplay` (`src/app.ts:931`, `src/app.ts:1058`).
- Dialog systems: `showQuestion`, `showDirectionQuestion`, `showInventoryDialog` (`src/app.ts:1206`, `src/app.ts:1329`, `src/app.ts:1456`).
- Keyboard control path: `handleKeyDown` (`src/app.ts:1978`).
- Camera path: `updateCamera`, mouse handlers (`src/app.ts:2253`, `src/app.ts:2283`).

## Protocol Contract (Server -> Client)
- Map/data: `map_glyph`, `player_position`, `force_player_redraw`, `tile_not_found`, `area_refresh_complete`, `clear_scene`.
- Text/UI: `text`, `raw_print`, `question`, `direction_question`, `position_request`, `name_request`, `inventory_update`.
- Player stats: `status_update`.

## Protocol Contract (Client -> Server)
- `input` (all gameplay and menu keystrokes).
- `request_tile_update` (single tile refresh).
- `request_area_update` (region refresh).

## High-Risk Zones
- Async input state in server session (`waitingForInput`, `waitingForPosition`, `waitingForMenuSelection`).
- Multi-pickup flow (`isInMultiPickup`, `menuSelections`, selection confirmation).
- Tile classification in `updateTile` (glyph ranges and char-based overrides).
- Question/dialog state flags (`isInQuestion`, `isInDirectionQuestion`) and escape handling.
