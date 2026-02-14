# NetHack 3D

Play in browser: https://jamesiv4.github.io/nethack-3d/

NetHack 3D lets you play classic NetHack in a fully interactive 3D dungeon, right in your browser.

## Screenshots

| Combat (Gnomish Mines)                                                                                                                                                                                                   | Enhanced Combat Visuals (Tile shake, damage numbers, blood)                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [![Combat in the Gnomish Mines](https://github.com/JamesIV4/nethack-3d/blob/main/docs/screenshots/combat-gnomish-mines.png)](https://github.com/JamesIV4/nethack-3d/blob/main/docs/screenshots/combat-gnomish-mines.png) | [![Blood effects during combat](docs/screenshots/blood-effects-combat.png)](docs/screenshots/blood-effects-combat.png) |
| Attributes                                                                                                                                                                                                               | Inventory                                                                                                              |
| [![Attributes panel](https://github.com/JamesIV4/nethack-3d/blob/main/docs/screenshots/attributes-panel.png)](https://github.com/JamesIV4/nethack-3d/blob/main/docs/screenshots/attributes-panel.png)                    | [![Inventory panel](docs/screenshots/inventory-panel.png)](docs/screenshots/inventory-panel.png)                       |

## Current Features

- Play NetHack in a 3D dungeon view while keeping core game rules and depth.
- Smooth map updates as you move, explore, and change floors.
- Clear 3D visuals for dungeon features like walls, doors, stairs, water, traps, fountains, and dark areas.
- Dynamic darkness and lighting around your hero to make exploration feel tense.
- Combat feedback effects (blood splatter and tile effects) so hits feel more readable and satisfying.
- Full HUD with health, power, stats, armor, gold, hunger, time, and dungeon depth.
- Live message log plus floating on-screen message popups during active play.
- Handles common NetHack prompts cleanly: yes/no, directional actions, text entry, and tile targeting/look mode.
- Better menu flow: readable category menus, inventory dialogs, multi-pickup selection, and menu paging.
- Fast character start: random hero or manual setup (name, role, race, gender, alignment).
- Extended command support with `#` so advanced playstyles are available.
- Desktop-friendly controls: keyboard-first with mouse support for map interaction and camera control.
- Mobile-friendly controls: tap/swipe movement, quick actions, extended command sheet, and mobile log view.

## Extras

- Quick reopen for the latest info panel with `Ctrl+M`.
- Power-user debug tools in browser devtools for tile refresh, status inspection, and game updates.

## Run Locally

1. `npm i`
2. `npm run dev`
3. Open `http://localhost:5173/`

## Scripts

- `npm run dev` - Start Vite dev server.
- `npm run build` - Build production bundles.
- `npm run preview` - Preview production build locally.
- `npm run glyphs:generate` - Regenerate glyph catalog from runtime artifacts.
- `npm run glyphs:check` - Verify checked-in glyph catalog is up to date.

## Architecture

- Main app bootstrap/debug helpers: `src/app.ts`
- React entry: `src/main.tsx`
- React UI shell: `src/ui/App.tsx`
- 3D engine and client-side interaction: `src/game/Nethack3DEngine.ts`
- Glyph catalog + behavior rules: `src/game/glyphs/*`
- Runtime worker bridge: `src/runtime/WorkerRuntimeBridge.ts`
- Worker runtime host: `src/runtime/runtime-worker.ts`
- NetHack callback adapter/state machine: `src/runtime/LocalNetHackRuntime.ts`

## GitHub Pages Deploy

1. Push this repo to GitHub.
2. In repository settings, go to `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Ensure your deploy branch matches `.github/workflows/deploy-gh-pages.yml` (`main` by default).
5. Push to `main` (or run the workflow manually).

The workflow builds with Vite and deploys the `dist/` folder.
