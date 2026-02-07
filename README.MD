# NetHack 3D

## Run

1. `npm i`
2. `npm run build`
3. `npm start`
4. Open `http://localhost:3000/`

## Architecture

- Main app bootstrap: `src/app.ts`
- 3D engine and UI: `src/game/Nethack3DEngine.ts`
- Runtime worker bridge: `src/runtime/WorkerRuntimeBridge.ts`
- Worker runtime host: `src/runtime/runtime-worker.ts`
- NetHack callback adapter: `src/runtime/LocalNetHackRuntime.ts`
