# Next.js + Browser WASM Migration Plan

## Goal
Convert the project from a server-hosted NetHack runtime (`server.js` + WebSocket protocol) to a Next.js app that runs NetHack WASM directly in the browser while preserving current gameplay behavior and UI.

## Current State (Baseline)
- `server.js` hosts static files, WebSocket, and the NetHack callback adapter.
- `src/app.ts` renders 3D and speaks to server via socket protocol.
- `public/nethack.js` + `public/nethack.wasm` are loaded by server-side bootstrap.
- Critical behavior (menus/questions/input timing) lives in server callback handling (`handleUICallback` + resolver flags).

## Target State
- Next.js serves UI routes and static WASM assets.
- NetHack WASM initializes in a browser-only runtime adapter.
- UI consumes adapter events directly (no WebSocket transport).
- Input goes directly from client controls to local adapter queue/resolvers.
- Optional persistence restores state on refresh (future phase if needed).

## Non-Goals (Initial Migration)
- Rewriting core rendering (`updateTile`, camera, materials) beyond required integration.
- Major UX redesign of dialogs/menus.
- Multiplayer or shared-server sessions.

## Architecture Strategy
Keep the existing message contract (`map_glyph`, `question`, `status_update`, etc.) for first migration pass.
- Build a browser `LocalNetHackSession` adapter that emits the same payloads currently sent over WS.
- Keep `handleServerMessage` in `src/app.ts` initially; feed it from local adapter instead of socket.
- Remove transport later after parity is proven.

## Phased Plan

## Phase 0 - Safety Net and Baseline Capture
- Freeze protocol behavior as reference:
  - Enumerate all outgoing server message types currently used by client.
  - Enumerate all incoming client input commands currently consumed by server.
- Add lightweight debug hooks for event tracing (input -> callback -> emitted message).
- Record a short manual test script:
  - movement, wait, inventory open/select/cancel, pickup menus, direction prompt, name prompt, level transition, reconnect refresh.

Deliverables:
- Protocol checklist document section in this file updated with confirmed message types.
- Manual parity test checklist committed.

## Phase 1 - Next.js Shell (No Runtime Change Yet)
- Scaffold Next.js app in-repo (or migrate project root if preferred).
- Move static assets to Next `public/`:
  - `nethack.js`, `nethack.wasm`, Three.js vendor files if still needed.
- Host existing client page in Next with a client-only mount component.
- Keep existing server/WebSocket path temporarily (proxy or separate process) to reduce blast radius.

Acceptance criteria:
- Current game still works through existing server path when launched from Next UI.

## Phase 2 - Browser Runtime Adapter
- Create `src/runtime/localNethackSession.ts` (or similar) to port server runtime logic:
  - WASM init (`globalThis.nethackCallback`, `shim_graphics_set_callback`).
  - callback switchboard currently in `handleUICallback`.
  - state flags and resolvers (`waitingForInput`, `waitingForMenuSelection`, `waitingForPosition`).
  - menu selection memory writing (`writeMenuSelectionResult`) using module heap APIs.
- Replace Node-only loading:
  - remove `fs.readFileSync` path.
  - load WASM via browser-compatible `locateFile` + fetch-based Emscripten flow.
- Replace `ws.send(JSON.stringify(...))` with local event emitter/callback.

Acceptance criteria:
- Adapter emits equivalent payloads for the core protocol event set.
- No WebSocket required for single-player loop.

## Phase 3 - Client Integration Without Socket
- Refactor `src/app.ts` connection layer:
  - replace `connectToServer` + `ws` dependencies with adapter instance.
  - keep `handleServerMessage` unchanged initially.
- Refactor `sendInput`, tile update requests, and area refresh requests to call adapter APIs directly.
- Remove reconnect status logic or repurpose as local runtime status.

Acceptance criteria:
- Manual script passes locally with no active WS server.

## Phase 4 - Parity Hardening and Cleanup
- Validate high-risk flows:
  - inventory action menus,
  - multi-pickup confirmations,
  - direction prompts,
  - name/yn questions,
  - status updates and player position redraw synchronization.
- Remove dead server transport code from client.
- Decommission `server.js` runtime path (or keep only as optional legacy mode behind flag).

Acceptance criteria:
- No behavioral regression in checklist scenarios.
- Build and run path documented for Next-only mode.

## Phase 5 - Optional Persistence and Performance
- Add local save strategy (IndexedDB/IDBFS if supported by runtime).
- Add startup loading indicator for large WASM and cache hints.
- Optimize rendering/update batching only after parity.

Acceptance criteria:
- Refresh behavior and load-time UX meet expected quality bar.

## Detailed Work Items

## Runtime Port Items (from `server.js`)
- Port session state container fields currently on `NetHackSession`.
- Port callback handlers for:
  - input: `shim_get_nh_event`, `shim_yn_function`, `shim_nh_poskey`
  - menu: `shim_start_menu`, `shim_add_menu`, `shim_end_menu`, `shim_select_menu`
  - render/text: `shim_print_glyph`, `shim_putstr`, `shim_raw_print`, `shim_clear_nhwindow`, `shim_cliparound`
  - status: `shim_status_update`
- Port map glyph batching timer behavior.
- Port inventory/info menu classification behavior.

## Client Refactor Items (from `src/app.ts`)
- Replace `WebSocket` field and socket setup lifecycle.
- Keep message dispatcher and tile update pipeline unchanged on first pass.
- Update `sendInput` to direct adapter call.
- Replace `request_tile_update` / `request_area_update` transport with direct adapter methods.

## Risk Register
- Async callback ordering regressions in menu/input flow.
- Emscripten runtime differences when initialized purely in browser.
- Pointer/memory writing bugs in menu selection return values.
- Refresh behavior change (loss of server-kept in-memory session).
- Next.js SSR conflicts with browser globals (`window`, `document`, WebGL).

## Mitigations
- Preserve protocol shape first; change internals only.
- Gate runtime init behind client-only component (`dynamic(..., { ssr: false })` pattern).
- Keep old server mode behind a feature flag during migration (`USE_LOCAL_WASM`).
- Add detailed callback/input logging until parity is reached.
- Validate each high-risk flow immediately after porting related callback group.

## Test Plan
- Build checks:
  - Next build passes.
  - TypeScript build passes.
- Runtime smoke:
  - game starts, map renders, player moves.
- Behavior checks:
  - inventory dialog open/select/cancel,
  - pickup menus incl. multi-select,
  - direction question selection,
  - yes/no questions,
  - status bar updates,
  - clear scene / level transitions.
- Regression check:
  - compare event traces old vs new for same key sequence.

## Rollout Plan
- Step 1: land Next shell + legacy runtime mode.
- Step 2: land local adapter behind feature flag, default off.
- Step 3: run parity script; fix blockers.
- Step 4: flip default to local adapter.
- Step 5: remove legacy WS/server path after stabilization window.

## Open Decisions
- Keep monorepo single package vs split `app`/`runtime` packages.
- Preserve `server.js` as optional fallback or fully retire.
- Persistence requirement in v1 (required vs deferred).
- Whether to retain vendored Three.js files vs npm import in Next bundling.

## Immediate Next Actions
1. Create Next.js skeleton and client-only game mount route.
2. Introduce `LocalNetHackSession` with WASM bootstrap and event emitter.
3. Wire `src/app.ts` to consume local adapter events while preserving existing dispatcher.
4. Run parity checklist and close highest-risk callback gaps first.
