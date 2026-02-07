# NetHack 3D

Play here: https://jamesiv4.github.io/nethack-3d/

## Run locally

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
- Glyph catalog + resolver: `src/game/glyphs/*`
- Runtime worker bridge: `src/runtime/WorkerRuntimeBridge.ts`
- Worker runtime host: `src/runtime/runtime-worker.ts`
- NetHack callback adapter: `src/runtime/LocalNetHackRuntime.ts`

## Glyph Catalog Workflow

- Generate catalog from the locked runtime artifacts:
  - `npm run glyphs:generate`
- Verify the checked-in catalog is current:
  - `npm run glyphs:check`

The generated source-of-truth file is:

- `src/game/glyphs/glyph-catalog.generated.ts`

If `public/nethack.js` or `public/nethack.wasm` changes, regenerate and commit the updated catalog.
