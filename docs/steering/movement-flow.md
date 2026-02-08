# Movement And Position Flow

This document is the source-of-truth reference for how movement and position input currently flows through NetHack 3D.

It focuses on:
- Browser key intake and movement mapping.
- Runtime input staging (`waitingForInput`, `waitingForPosition`, queues).
- NetHack callbacks that update player position and map state.
- Camera follow behavior tied to player position.
- Current cursor/targeting integration gaps.

## Main Files

- `src/game/Nethack3DEngine.ts`
  - `handleKeyDown`
  - `sendInput`
  - `isMovementInput`
  - `handleRuntimeEvent`
  - `updateTile`
  - `recordPlayerMovement`
  - `updateCamera`
- `src/runtime/WorkerRuntimeBridge.ts`
  - `sendInput`
- `src/runtime/runtime-worker.ts`
  - `send_input` command forwarding
- `src/runtime/LocalNetHackRuntime.ts`
  - `handleClientInput`
  - `processKey`
  - `handleUICallback`
  - `shim_get_nh_event`
  - `shim_nh_poskey`
  - `shim_cliparound`
  - `shim_curs`

## Runtime Movement Assumptions

The runtime boot config sets:
- `number_pad:1`
- `pickup_types:$`

`number_pad:1` matters because both engine and runtime map directional input around numpad semantics.

## End-To-End Flow (Normal Movement Key)

1. Browser keydown enters `Nethack3DEngine.handleKeyDown`.
2. Engine applies pre-filters and mode gates:
  - Alt/Meta handling (`__META__:` prefix path).
  - Escape dialog cancellation.
  - Ctrl shortcuts (`Ctrl+R`, `Ctrl+Shift+R`, `Ctrl+T`, `Ctrl+M`).
  - Inventory toggle (`i`) when no active question mode.
  - Modifier-key filtering.
  - Wait key normalization (`Space` or `.` -> `"."`).
  - Diagonal remap (`Home/PageUp/End/PageDown` -> `"7"/"9"/"1"/"3"`).
  - Question-mode specific routing.
3. Engine sends text key through `sendInput`.
4. `sendInput` updates `lastMovementInputAtMs` for movement keys during normal gameplay (used by first-movement unlock logic).
5. `WorkerRuntimeBridge.sendInput` posts `{ type: "send_input", input }` to worker.
6. `runtime-worker.ts` forwards `send_input` to `LocalNetHackRuntime.sendInput`.
7. `LocalNetHackRuntime.handleClientInput` receives key and:
  - Stores `latestInput` and `lastInputTime`.
  - Resolves `waitingForInput` or `waitingForPosition` promises if active.
  - Otherwise leaves key staged for synchronous callback consumption.
8. NetHack asks for input via callback:
  - `shim_get_nh_event` (general key event flow), or
  - `shim_nh_poskey` (position/targeting flow).
9. Runtime converts key via `processKey` (arrow-to-numpad mapping, enter/escape handling, meta escape encoding).
10. NetHack advances game state and emits callbacks:
  - `shim_cliparound` for player-centered map position updates.
  - `shim_print_glyph` for map glyph updates.
11. Runtime emits worker events:
  - `player_position`
  - `force_player_redraw`
  - `map_glyph` or `map_glyph_batch`
12. Engine receives runtime events in `handleRuntimeEvent` and updates:
  - `playerPos`
  - tile meshes/overlays
  - status text and lighting state
13. Render loop calls `updateCamera` every frame; camera follows `playerPos` (plus pan offset), not any targeting cursor.

## Engine Input Routing Details

### `handleKeyDown` mode routing

- Normal gameplay (no question flags):
  - Movement keys and command keys pass through.
  - Diagonal navigation keys are remapped before send.
- Direction-question mode (`isInDirectionQuestion`):
  - Arrow keys are mapped to numpad directions.
  - `Home/PageUp/End/PageDown`, digits `1-9`, `<`, `>`, `s`, and wait keys are handled.
  - Sending a direction immediately hides the direction dialog.
- General question mode (`isInQuestion`):
  - Pickup dialogs do special multi-select handling.
  - Non-pickup question sends key then closes question UI.

### `sendInput` and movement bookkeeping

`sendInput` only stamps `lastMovementInputAtMs` when all are true:
- `!hasPlayerMovedOnce`
- `!isInQuestion`
- `!isInDirectionQuestion`
- `isMovementInput(input) === true`

This timestamp is consumed by `recordPlayerMovement` to unlock first-movement-dependent UX behavior.

## Runtime Input State Machine

### Core mutable state

- `latestInput`
- `lastInputTime`
- `inputCooldown` (100ms)
- `waitingForInput`, `inputResolver`
- `waitingForPosition`, `positionResolver`
- `queuedInputs`
- `queuedEventInputs`
- `queuedRawKeyCodes`

### Resolver precedence in `handleClientInput`

When a non-meta key arrives:
1. Resolve `waitingForInput` first if active.
2. Else resolve `waitingForPosition` if active.
3. Else keep input staged (`latestInput`).

This precedence is important when two async waits could race.

### `shim_get_nh_event` read priority

1. `queuedRawKeyCodes.shift()`
2. `queuedEventInputs.shift()` -> `processKey`
3. `queuedInputs.shift()` -> `processKey`
4. `latestInput` if `Date.now() - lastInputTime < inputCooldown`
  - `latestInput` is consumed and cleared in this branch.
5. Otherwise create async wait:
  - `waitingForInput = true`
  - resolver stored in `inputResolver`

### `shim_nh_poskey` read priority

1. `queuedRawKeyCodes.shift()`
2. `queuedInputs.shift()` -> `processKey`
3. `latestInput` if:
  - within cooldown, and
  - not meta input (`!isMetaInput(latestInput)`)
  - note: this branch does not clear `latestInput`
4. Otherwise create async wait:
  - `waitingForPosition = true`
  - resolver stored in `positionResolver`

### Meta input behavior (`__META__:`)

Meta keys are encoded as ESC + key:
- Runtime queues raw codes for ESC (27) and the primary key char code.
- If `waitingForInput` is active, resolver is completed immediately with ESC and the follow-up key is queued.
- If `waitingForPosition` is active, resolver is completed using the queued raw stream (first code is ESC).

## Position Updates And Player Tracking

There are three independent player-position update paths in the engine:

1. `player_position` runtime event:
  - Engine updates `playerPos`.
  - Calls `recordPlayerMovement`.
  - Marks lighting dirty.
2. `force_player_redraw` runtime event:
  - Engine updates `playerPos`.
  - Calls `recordPlayerMovement`.
  - Redraws old/new tiles defensively when glyph updates are incomplete.
3. `updateTile` path when incoming glyph is player glyph:
  - Engine updates `playerPos` from glyph coordinates.
  - Calls `recordPlayerMovement`.

Implication: movement-like state can change even without a movement key press (teleport, forced redraw sync, map replay).

## First-Movement Unlock Logic

`recordPlayerMovement` controls `hasPlayerMovedOnce`:
- First observed position only initializes tracking (`hasSeenPlayerPosition`), no unlock.
- Unlock happens only when:
  - position actually changed, and
  - movement input timestamp is recent (`movementUnlockWindowMs`, currently 5000ms).

This avoids unlocking movement-dependent UI effects from stale or non-player-driven position updates.

## Camera Follow Behavior

`updateCamera` runs each animation frame and always targets:
- `playerPos.x * TILE_SIZE + cameraPanX`
- `-playerPos.y * TILE_SIZE + cameraPanY`

Follow uses exponential smoothing:
- `cameraFollowTarget` is updated every frame.
- `cameraFollowCurrent` lerps toward target using half-life (`cameraFollowHalfLifeMs`).

Important:
- Camera follows player position only.
- Right-mouse panning offsets follow target (`cameraPanX`, `cameraPanY`).
- There is no separate targeting cursor camera target today.

## Question And Direction Mode Interactions

- `direction_question` runtime event sets `isInQuestion = true` and calls `showDirectionQuestion`, which sets `isInDirectionQuestion = true`.
- `hideDirectionQuestion` clears both direction and general question flags.
- Escape handling also clears both flags and hides relevant dialogs.

Because these flags gate `handleKeyDown`, movement behavior depends heavily on whether question mode is active.

## Menu Interception That Can Affect Key Flow

Inside `handleClientInput`, when menu state is active:
- Single-selection menu keys can be tracked in `menuSelections`.
- Multi-pickup mode toggles selection on single-char input.
- Enter/Escape can resolve menu selection waiters.

This menu logic runs before general resolver logic and can absorb keys that would otherwise look like movement commands.

## Cursor And Position Request Notes

- Engine has a `position_request` UI pathway (`showPositionRequest`), but runtime currently does not emit `position_request` in active callback paths.
- Runtime callback `shim_curs` currently logs cursor coordinates and returns; it does not emit cursor-position events to the engine.

Implication:
- Targeting/far-look cursor motion exists in NetHack callbacks, but the 3D engine currently has no emitted cursor state to render/highlight.

## Invariants To Preserve During Movement Changes

- Keep movement key flow through `sendInput` unless intentionally replacing movement bookkeeping.
- Preserve resolver precedence unless changing it deliberately and holistically.
- Keep `shim_get_nh_event` and `shim_nh_poskey` read priorities in mind before adding new queues or key staging.
- Maintain consistent directional mapping between engine `handleKeyDown` and runtime `processKey`.
- Preserve question and direction gating semantics (`isInQuestion`, `isInDirectionQuestion`).
- Do not break `shim_cliparound` + `force_player_redraw` fallback behavior.
- Keep first-movement unlock logic coherent with any new movement mode.

## Manual Validation Checklist (Movement-Related Changes)

1. Normal cardinal movement: arrow keys and `hjkl`.
2. Diagonal movement: numpad and `Home/PageUp/End/PageDown`.
3. Wait behavior: `.` and Space.
4. Direction question flow: keys route correctly and question closes as expected.
5. Inventory/question dialogs still intercept keys correctly.
6. Escape behavior still cancels active prompts and closes overlays correctly.
7. Player position updates still occur from:
  - cliparound events,
  - forced redraw events,
  - player glyph tile updates.
8. Camera follow remains stable during normal movement and map redraw bursts.
9. Meta input (Alt/Meta chords) still routes as ESC + key.
10. `Ctrl+T`, `Ctrl+R`, and `Ctrl+Shift+R` still work.

