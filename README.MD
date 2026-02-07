# NetHack 3D

git Play here: https://jamesiv4.github.io/nethack-3d/

## Run

1. `npm i`
2. `npm run build`
3. `npm start`
4. Open `http://localhost:3000/`

## GitHub Pages Deploy

1. Push this repo to GitHub.
2. In repository settings:
   - Go to `Settings > Pages`.
   - Set `Source` to `GitHub Actions`.
3. Ensure your default deploy branch matches `.github/workflows/deploy-gh-pages.yml` (`main` by default).
4. Push to `main` (or run the workflow manually).

The workflow builds the app and deploys the `public/` folder, including:

- `app.js`
- `runtime-worker.js`
- `nethack.js`
- `nethack.wasm`
- `index.html`

## Architecture

- Main app bootstrap: `src/app.ts`
- 3D engine and UI: `src/game/Nethack3DEngine.ts`
- Runtime worker bridge: `src/runtime/WorkerRuntimeBridge.ts`
- Worker runtime host: `src/runtime/runtime-worker.ts`
- NetHack callback adapter: `src/runtime/LocalNetHackRuntime.ts`
