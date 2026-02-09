# Movement And Position Flow

This document is the source-of-truth for movement and position input behavior
after the runtime interaction overhaul.

It focuses on:
- Browser key intake and movement mapping.
- Runtime single-consume input broker flow.
- Shared callback consumption path for event/position/question input.
- Far-look position FSM behavior.
- Player and cursor update emission.

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
  - `sendInputSequence`
- `src/runtime/runtime-worker.ts`
  - command forwarding for `send_input` and `send_input_sequence`
- `src/runtime/LocalNetHackRuntime.ts`
  - `handleClientInput`
  - `requestInputCode`
  - `handleShimGetNhEvent`
  - `handleShimYnFunction`
  - `handleShimNhPoskey`
  - `shim_cliparound`
  - `shim_curs`
- `src/runtime/input/RuntimeInputBroker.ts`
  - broker queue + waiter coordination

## Runtime Movement Assumptions

Runtime boot config includes:
- `number_pad:1`
- `pickup_types:$`

`number_pad:1` is still required because both engine and runtime translate
directional input using numpad semantics.

## End-To-End Flow (Normal Movement Key)

1. Browser keydown enters `Nethack3DEngine.handleKeyDown`.
2. Engine applies input gates and remaps (dialogs, direction prompts,
   movement remaps, command shortcuts, meta handling).
3. Engine sends input via `sendInput`.
4. `WorkerRuntimeBridge` posts `send_input` to worker.
5. `runtime-worker.ts` forwards to `LocalNetHackRuntime.sendInput`.
6. `LocalNetHackRuntime.handleClientInput` normalizes the key and enqueues it
   into `RuntimeInputBroker` as an `InputToken`.
7. NetHack callback waits (`shim_get_nh_event` or `shim_nh_poskey`) request
   input through `requestInputCode(kind)`.
8. Broker returns exactly one token for exactly one request (FIFO).
9. Runtime converts key with `processKey` and returns one keycode to NetHack.
10. NetHack advances state and emits updates (`shim_cliparound`,
    `shim_print_glyph`, status/menu/text callbacks).
11. Runtime emits worker events (`player_position`, `force_player_redraw`,
    `map_glyph_batch`, etc.).
12. Engine consumes runtime events in `handleRuntimeEvent`.

## Runtime Input Broker Model

### Core types

- `InputToken`: `{ key, source, createdAt }`
- `InputRequestKind`: `"event" | "position" | "menu"`
- `InputConsumeResult`: request outcome or cancel code

### Invariants

- Single consume: one token is consumed by one waiter only.
- FIFO ordering: input order is stable across callbacks.
- Kind-aware routing: tokens can be tagged for specific callback kinds, modeled
  after Vulture response typing (`V_RESPOND_*`), so menu/question/system
  sequences are not consumed by unrelated waits.
- No cooldown reuse: there is no `latestInput`/timeout replay behavior.
- Shared path: event, position, and question waits all consume through broker.

### API

- `enqueueTokens(tokens)`
- `requestNext(requestKind)`
- `cancelAll(cancelCode)`
- `drain()`
- `dequeueToken()` and `prependToken()` for extended-command parsing

## Callback Consumption Rules

### `shim_get_nh_event`

- Uses `handleShimGetNhEvent` and calls `requestInputCode("event")`.
- If position mode was active, it is closed before waiting for a general key.
- No fallback to cached/recent input.

### `shim_yn_function`

- Uses `handleShimYnFunction`.
- For direction questions and normal y/n prompts, waits through
  `waitForQuestionInput()`, which internally uses `requestInputCode("event")`.
- Keeps current auto-answer behavior for container type prompts.

### `shim_nh_poskey`

- Uses `handleShimNhPoskey` and calls `requestInputCode("position")`.
- Integrates with explicit far-look FSM (below).
- No duplicate consumption from queue/cached input mix.

## Far-Look Position FSM

`farLookMode` values:
- `none`
- `armed`
- `active`

Transitions:
1. `none -> armed` when `;` is consumed by `shim_get_nh_event`.
2. `armed -> active` when next `shim_nh_poskey` begins.
3. `active -> none` on far-look exit input (`Escape`/`Enter`) or when general
   event input resumes.

Emitted events:
- `position_input_state` when entering/exiting active position mode.
- `position_cursor` from `shim_curs` and cliparound-in-position context.

## Menu Input Isolation

Menu selection state is isolated from the general broker path:
- `pendingMenuSelection` tracks only active menu completion wait.
- `menuSelectionReadyCount` stores completion result until `shim_select_menu`
  consumes it.
- Multi-pickup toggle keys are handled in menu mode without leaking into
  unrelated event waits.

`shim_select_menu` still writes `menu_item` structs via pointer arguments, but
waiting/resolution is centralized to menu-specific state.

## Meta and Extended Commands

- Meta input remains encoded as deterministic token expansion.
- Standard meta behavior: enqueue `Escape` then primary key token.
- Bound meta extended commands enqueue: `#`, command text, `Enter`.
- Extended command parsing consumes from broker queue and pushes back
  non-command tokens using `prependToken()`.

## Status Updates (Flush-Aligned)

- `shim_status_update` now accumulates updates in `statusPending`.
- On flush/reset pseudo-fields (`BL_FLUSH`, `BL_RESET`,
  `BL_CHARACTERISTICS`), runtime emits batched `status_update` events in stable
  field order.
- `latestStatusUpdates` remains reconnect snapshot source.

## Position Updates And Player Tracking

Player position update paths in engine are unchanged:
1. `player_position` event
2. `force_player_redraw` event
3. player-glyph detection in tile update path

Movement-dependent UX logic in engine (`recordPlayerMovement`) remains
compatible with the new runtime consume model.

## Camera Follow Behavior

Camera behavior is unchanged:
- follows `playerPos` each frame with smoothing
- pan offsets remain additive
- far-look cursor does not retarget camera

## Invariants To Preserve

- Keep public worker command names stable (`send_input`, `send_input_sequence`).
- Keep runtime event payload shapes stable for engine consumers.
- Keep all key-consuming callbacks routed through broker request flow.
- Do not reintroduce cooldown or latest-input replay logic.
- Keep menu waiters isolated from non-menu input waiters.
- Keep far-look state transitions deterministic and observable.

## Manual Validation Checklist

1. Cardinal movement with `hjkl`, arrows, and numpad.
2. Diagonal movement with `yubn`, numpad, `Home/PageUp/End/PageDown`.
3. Hold-to-repeat movement without extra step on release.
4. Wait behavior with `.` and Space.
5. Direction prompts and closure behavior.
6. Far-look `;` flow, cursor motion, and clean exit.
7. Multi-pickup toggles, confirm, cancel.
8. Inventory/single-select question flows.
9. Meta/Alt and extended command entry.
10. Escape across menus/questions/position mode.
