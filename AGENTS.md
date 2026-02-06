# Agent Steering

Start here before making changes.

## Project Summary
- NetHack 3D is a two-process JavaScript/TypeScript app:
- `server.js` runs NetHack WebAssembly, handles shim callbacks, and bridges gameplay data over WebSocket.
- `src/app.ts` is a browser client that renders the map with Three.js and handles UI/input.
- `public/index.html` provides the static shell and mount points for overlays.

## Core Runtime Paths
- Server startup and socket wiring: `server.js:1311`, `server.js:1356`, `server.js:1359`.
- NetHack callback bridge entrypoint: `server.js:390` (`handleUICallback`).
- Client network message dispatcher: `src/app.ts:278` (`handleServerMessage`).
- Tile rendering/classification: `src/app.ts:721` (`updateTile`).
- Keyboard and interaction pipeline: `src/app.ts:1978` (`handleKeyDown`).

## Steering Documents
- Architecture and file map: `docs/steering/project-structure.md`
- Logic hotspots and edit playbook: `docs/steering/logic-hotspots.md`

## Working Rules For Agents
- Treat `server.js` and `src/app.ts` as source of truth; `public/app.js` is build output from `src/app.ts`.
- Prefer protocol-compatible changes: if adding a message type on one side, update both server and client handlers in the same patch.
- Keep menu/input behavior stable, especially async promise resolution in `server.js` (`waitingForInput`, `waitingForMenuSelection`, `waitingForPosition`).
- Validate rendering-impact changes by checking player position updates, tile refresh commands, and question dialogs.
