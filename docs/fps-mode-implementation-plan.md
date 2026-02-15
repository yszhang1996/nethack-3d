# FPS Mode Implementation Plan

## Goal
- Add an optional `Play Mode` startup setting with:
  - `Normal` (default, current behavior)
  - `FPS` (alternative controls and rendering style)

## Requested FPS Mode Behavior
- Movement on `W/A/S/D`.
- `s` (search) remapped to `f`.
- `f` (fire) remapped to left click, firing in the direction the player is looking.
- Missing inventory command hotkeys (consumed by `W/A/S/D`) exposed via an item contextual menu on inventory item click.
- While mouselooking, highlight the next forward tile with a brightening effect.
- Larger-appearing play space via larger tile scale in FPS mode.
- Monsters rendered as outlined letter billboards (camera-facing).
- Floor tile under monsters inferred from cache (and shim fallback path defined if needed).

## Constraints To Preserve
- Do not break runtime async input/menu state behavior:
  - `waitingForInput`
  - `waitingForMenuSelection`
  - `waitingForPosition`
- Keep Normal mode behavior unchanged.
- Keep runtime event/command contracts synchronized if any payload changes are added.

## Phase 1: Mode Model + Startup Selection
- Add a play-mode type in shared UI types:
  - `src/game/ui-types.ts`
  - `type PlayMode = "normal" | "fps"`
- Extend startup config passed from React to engine:
  - Add `playMode?: PlayMode` to `CharacterCreationConfig`.
  - Default to `"normal"` at all call sites.
- Update startup dialog in `src/ui/App.tsx`:
  - Add a `Play Mode` selector in both random and create flows.
  - Keep default value `Normal`.
- Ensure engine receives and stores selected play mode:
  - `src/game/Nethack3DEngine.ts` constructor options.

## Phase 2: Input Profile Split (Normal vs FPS)
- Centralize mode-aware key mapping in `src/game/Nethack3DEngine.ts`:
  - Introduce a small control-profile layer in `handleKeyDown` / mouse handlers.
  - Keep existing path for Normal mode untouched.
- FPS keyboard behavior:
  - `W/A/S/D` -> directional movement input.
  - `f` -> send NetHack search command (`s`).
  - Preserve existing prompt/question/inventory gating rules.
- FPS mouse behavior:
  - Left click triggers fire flow:
    - compute direction from current view
    - show a short visual confirmation line for the chosen fire direction
    - send `f` then direction input
  - The confirmation line updates as mouselook changes and snaps to valid fire directions.
  - Keep current map-click behavior in Normal mode.

## Phase 3: FPS Look Direction + Forward-Tile Highlight
- Add a mode-only forward-target resolver in `src/game/Nethack3DEngine.ts`:
  - derive forward tile from camera/view direction and player position.
  - quantize to NetHack 8-way direction for consistency with movement/fire.
- Add an FPS aim-line helper:
  - render/update a directional line based on current mouselook.
  - on left-click fire, briefly emphasize the current line as confirmation.
- Add a highlight visual:
  - one reusable mesh/overlay for the current forward tile.
  - brightening effect only; no tile-type mutation.
- Update on:
  - mouse look/camera yaw changes
  - player position changes
  - tile updates and scene clears
  - modal/prompt state transitions (hide when input should be frozen)

## Phase 4: Inventory Contextual Item Actions (FPS)
- Extend controller/UI contract for item actions:
  - `src/game/ui-types.ts` (`Nethack3DEngineController`)
  - `src/game/Nethack3DEngine.ts` implementations
  - `src/ui/App.tsx` click handlers/render state
- In FPS inventory dialog:
  - clicking an item opens a contextual action menu for that item.
  - selecting an action sends the command + item accelerator sequence.
- Actions to include (initial set):
  - apply, drop, eat, quaff, read, throw, wield, wear, take off, put on, remove, zap, cast
- Keep existing static inventory display for Normal mode.

## Phase 5: FPS Render Style (Scale + Monster Billboards)
- Introduce mode-aware world scaling in `src/game/Nethack3DEngine.ts`:
  - add a tile/world scale factor for FPS mode.
  - route tile/world coordinate conversions through helpers to avoid drift.
- Monster rendering:
  - render monster glyph letters on camera-facing billboards (sprites/planes).
  - add text outline in glyph texture generation (stroke + fill) for readability.
- Floor-under-monster handling:
  - maintain a terrain cache for non-monster tiles (`lastKnownTerrain` + explicit base terrain map).
  - when monster glyph arrives:
    - use cached terrain if available
    - otherwise use a conservative fallback terrain style and mark for later correction.

## Phase 6: Shim Fallback Path (Only If Needed)
- If unseen-monster floor inference quality is insufficient:
  - add a runtime shim payload path for underlying terrain at monster positions.
  - update both sides together:
    - emitter: `src/runtime/LocalNetHackRuntime.ts`
    - handler: `src/game/Nethack3DEngine.ts`
    - typing: `src/runtime/types.ts`
- Keep this as a follow-up unless inference proves inadequate.

## Phase 7: Validation Checklist
- Startup:
  - Play Mode selector defaults to `Normal`.
  - Existing startup flows still boot correctly.
- Normal mode regression checks:
  - movement, prompts, inventory, direction questions, map clicks.
- FPS mode checks:
  - `W/A/S/D` movement works.
  - `f` performs search.
  - left click fires in look direction.
  - forward-tile highlight tracks view direction correctly.
  - inventory item contextual actions issue correct command sequences.
  - monsters render as outlined billboards.
  - floor under monsters uses cache and recovers after tile refreshes.
- Async flow safety:
  - no deadlocks in question/menu/position waits.

## Delivery Order
1. Phase 1 + Phase 2 (mode selection + controls).
2. Phase 3 (forward highlight).
3. Phase 4 (inventory contextual menu).
4. Phase 5 (render style updates).
5. Phase 6 only if floor inference gaps remain.
6. Phase 7 validation pass.

## Open Decisions To Confirm Before Implementation
- Diagonal movement in FPS mode:
  - keep arrow/numpad diagonals only, or add dedicated FPS diagonal binds.
- Mouse-look activation model:
  - always-on look vs hold-to-look (right mouse).
- Exact contextual action list for inventory items (initial set above is proposed).
