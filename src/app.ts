import { Nethack3DEngine } from "./game";

const game = new Nethack3DEngine();

(window as any).nethackGame = game;

(window as any).refreshTile = (x: number, y: number) => {
  game.requestTileUpdate(x, y);
};

(window as any).refreshArea = (
  centerX: number,
  centerY: number,
  radius: number = 3
) => {
  game.requestAreaUpdate(centerX, centerY, radius);
};

(window as any).refreshPlayerArea = (radius: number = 5) => {
  game.requestPlayerAreaUpdate(radius);
};

(window as any).dumpStatusDebug = () => {
  return (game as any).statusDebugHistory;
};

(window as any).toggleInfoMenu = () => {
  (game as any).toggleInfoMenuDialog();
};

console.log("NetHack 3D debugging helpers available:");
console.log("  refreshTile(x, y) - Refresh a specific tile");
console.log("  refreshArea(x, y, radius) - Refresh an area");
console.log("  refreshPlayerArea(radius) - Refresh around player");
console.log("  dumpStatusDebug() - Get recent status_update payloads");
console.log("  Ctrl+T - Refresh player tile");
console.log("  Ctrl+R - Refresh player area (radius 5)");
console.log("  Ctrl+Shift+R - Refresh large player area (radius 10)");
console.log("Movement controls:");
console.log("  Arrow keys - Cardinal directions (N/S/E/W)");
console.log("  Numpad 1-9 - All directions including diagonals");
console.log("  Home/PgUp/End/PgDn - Diagonal movement (NW/NE/SW/SE)");
console.log("  Numpad 5 or Space - Wait/rest");
console.log("Interface controls:");
console.log("  'i' - Open/close inventory dialog");
console.log("  ESC - Close dialogs or cancel actions");
console.log("  Ctrl+M - Toggle latest information panel");

export default game;
