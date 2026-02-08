import { useEffect, useMemo, useRef } from "react";
import { Nethack3DEngine } from "../game";
import type { NethackMenuItem } from "../game/ui-types";
import { registerDebugHelpers } from "../app";
import { createEngineUiAdapter } from "../state/engineUiAdapter";
import { useGameStore } from "../state/gameStore";

const directionChoices = [
  { key: "7", label: "↖" },
  { key: "8", label: "↑" },
  { key: "9", label: "↗" },
  { key: "4", label: "←" },
  { key: "5", label: "•" },
  { key: "6", label: "→" },
  { key: "1", label: "↙" },
  { key: "2", label: "↓" },
  { key: "3", label: "↘" },
];

function expandChoiceSpec(spec: string): string[] {
  const normalized = String(spec || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+or\s+/gi, " ")
    .replace(/[,/|]/g, " ")
    .replace(/\s+/g, "")
    .replace(/[\[\]]/g, "");

  if (!normalized) {
    return [];
  }

  const expanded: string[] = [];
  const seen = new Set<string>();
  const addChoice = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    expanded.push(value);
  };

  const canExpandRange = (start: string, end: string): boolean => {
    const isLower = (value: string) => value >= "a" && value <= "z";
    const isUpper = (value: string) => value >= "A" && value <= "Z";
    const isDigit = (value: string) => value >= "0" && value <= "9";
    return (
      (isLower(start) && isLower(end)) ||
      (isUpper(start) && isUpper(end)) ||
      (isDigit(start) && isDigit(end))
    );
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const hasRangeEnd = i + 2 < normalized.length && normalized[i + 1] === "-";

    if (hasRangeEnd) {
      const end = normalized[i + 2];
      if (canExpandRange(current, end)) {
        const startCode = current.charCodeAt(0);
        const endCode = end.charCodeAt(0);
        const step = startCode <= endCode ? 1 : -1;
        for (
          let code = startCode;
          step > 0 ? code <= endCode : code >= endCode;
          code += step
        ) {
          addChoice(String.fromCharCode(code));
        }
        i += 2;
        continue;
      }
    }

    if (current !== "-") {
      addChoice(current);
    }
  }

  return expanded;
}

function parseQuestionChoices(question: string, choices: string): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const addChoice = (value: string): void => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  for (const choice of expandChoiceSpec(choices)) {
    addChoice(choice);
  }

  const bracketMatch = String(question || "").match(/\[([^\]]+)\]/);
  if (bracketMatch && bracketMatch[1]) {
    for (const choice of expandChoiceSpec(bracketMatch[1])) {
      addChoice(choice);
    }
  }

  return merged;
}

function getQuestionChoiceLabel(
  choice: string,
  inventoryItems: NethackMenuItem[],
): string {
  const normalizedChoice = choice.trim();
  if (!normalizedChoice) {
    return choice;
  }
  const inventoryItem = inventoryItems.find((item) => {
    if (!item || item.isCategory || typeof item.accelerator !== "string") {
      return false;
    }
    return (
      item.accelerator === normalizedChoice ||
      item.accelerator.toLowerCase() === normalizedChoice.toLowerCase()
    );
  });
  if (!inventoryItem || typeof inventoryItem.text !== "string") {
    return normalizedChoice;
  }
  return `${normalizedChoice}) ${inventoryItem.text.trim()}`;
}

export default function App(): JSX.Element {
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const adapter = useMemo(() => createEngineUiAdapter(), []);
  const setEngineController = useGameStore((state) => state.setEngineController);

  const loadingVisible = useGameStore((state) => state.loadingVisible);
  const statusText = useGameStore((state) => state.statusText);
  const connectionState = useGameStore((state) => state.connectionState);
  const connectionText = useGameStore((state) => state.connectionText);
  const gameMessages = useGameStore((state) => state.gameMessages);
  const floatingMessages = useGameStore((state) => state.floatingMessages);
  const playerStats = useGameStore((state) => state.playerStats);
  const question = useGameStore((state) => state.question);
  const directionQuestion = useGameStore((state) => state.directionQuestion);
  const infoMenu = useGameStore((state) => state.infoMenu);
  const inventory = useGameStore((state) => state.inventory);
  const positionRequest = useGameStore((state) => state.positionRequest);
  const controller = useGameStore((state) => state.engineController);

  useEffect(() => {
    if (!canvasRootRef.current) {
      return;
    }
    const engine = new Nethack3DEngine({
      mountElement: canvasRootRef.current,
      uiAdapter: adapter,
    });
    setEngineController(engine);
    registerDebugHelpers(engine);
    return () => {
      setEngineController(null);
    };
  }, [adapter, setEngineController]);

  const hpPercentage =
    playerStats.maxHp > 0
      ? Math.max(0, Math.min(100, (playerStats.hp / playerStats.maxHp) * 100))
      : 0;
  const hpColor =
    hpPercentage > 60 ? "#00ff00" : hpPercentage > 30 ? "#ffaa00" : "#ff0000";
  const powerPercentage =
    playerStats.maxPower > 0
      ? Math.max(
          0,
          Math.min(100, (playerStats.power / playerStats.maxPower) * 100),
        )
      : 0;
  const parsedQuestionChoices = question
    ? parseQuestionChoices(question.text, question.choices)
    : [];

  return (
    <>
      <div className="nh3d-canvas-root" ref={canvasRootRef} />

      <div className={`loading${loadingVisible ? "" : " is-hidden"}`} id="loading">
        <div>NetHack 3D</div>
        <div className="loading-subtitle">Starting local runtime...</div>
      </div>

      <div className="top-left-ui with-stats">
        <div id="game-status">{statusText}</div>
        <div id="game-log">
          {gameMessages.map((message, index) => (
            <div key={`${index}-${message}`}>{message}</div>
          ))}
        </div>
      </div>

      <div id="connection-status" data-state={connectionState}>
        {connectionText}
      </div>

      <div id="floating-log-message-layer">
        {floatingMessages.map((entry, index) => (
          <div
            className="floating-message-container"
            key={entry.id}
            style={{ top: `${-index * 30}px` }}
          >
            <div className="floating-message-text">{entry.text}</div>
          </div>
        ))}
      </div>

      <div id="stats-bar">
        <div className="nh3d-stats-name">
          {playerStats.name} (Lvl {playerStats.level})
        </div>
        <div className="nh3d-stats-meter">
          <div className="nh3d-stats-meter-label nh3d-stats-meter-label-hp">
            HP: {playerStats.hp}/{playerStats.maxHp}
          </div>
          <div className="nh3d-stats-meter-track">
            <div
              className="nh3d-stats-meter-fill"
              style={{
                width: `${hpPercentage}%`,
                backgroundColor: hpColor,
              }}
            />
          </div>
        </div>
        {playerStats.maxPower > 0 ? (
          <div className="nh3d-stats-meter">
            <div className="nh3d-stats-meter-label nh3d-stats-meter-label-pw">
              Pw: {playerStats.power}/{playerStats.maxPower}
            </div>
            <div className="nh3d-stats-meter-track">
              <div
                className="nh3d-stats-meter-fill nh3d-stats-meter-fill-pw"
                style={{ width: `${powerPercentage}%` }}
              />
            </div>
          </div>
        ) : null}
        <div className="nh3d-stats-group">
          <div className="nh3d-stats-core">St:{playerStats.strength}</div>
          <div className="nh3d-stats-core">Dx:{playerStats.dexterity}</div>
          <div className="nh3d-stats-core">Co:{playerStats.constitution}</div>
          <div className="nh3d-stats-core">In:{playerStats.intelligence}</div>
          <div className="nh3d-stats-core">Wi:{playerStats.wisdom}</div>
          <div className="nh3d-stats-core">Ch:{playerStats.charisma}</div>
        </div>
        <div className="nh3d-stats-group">
          <div className="nh3d-stats-secondary-ac">AC:{playerStats.armor}</div>
          <div className="nh3d-stats-secondary-gold">$:{playerStats.gold}</div>
          <div className="nh3d-stats-secondary-time">T:{playerStats.time}</div>
        </div>
        <div className="nh3d-stats-location">
          <div className="nh3d-stats-dungeon">
            {playerStats.dungeon} {playerStats.dlevel}
          </div>
          <div className="nh3d-stats-hunger">
            {playerStats.hunger}
            {playerStats.encumbrance ? ` ${playerStats.encumbrance}` : ""}
          </div>
        </div>
      </div>

      {question ? (
        <div className="nh3d-dialog nh3d-dialog-question is-visible" id="question-dialog">
          <div className="nh3d-question-text">{question.text}</div>
          {question.menuItems.length > 0 ? (
            question.isPickupDialog ? (
              <>
                {question.menuItems.map((item, index) =>
                  item.isCategory ||
                  !item.accelerator ||
                  !String(item.accelerator).trim() ? (
                    <div className="nh3d-menu-category" key={`cat-${index}`}>
                      {item.text}
                    </div>
                  ) : (
                    <div
                      className={`nh3d-pickup-item${
                        question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )
                          ? " nh3d-pickup-item-selected"
                          : ""
                      }`}
                      key={`pickup-${item.accelerator}-${index}`}
                      onClick={() =>
                        controller?.togglePickupChoice(String(item.accelerator))
                      }
                    >
                      <input
                        checked={question.selectedAccelerators.includes(
                          String(item.accelerator),
                        )}
                        className="nh3d-pickup-checkbox"
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          controller?.togglePickupChoice(String(item.accelerator))
                        }
                        type="checkbox"
                      />
                      <span className="nh3d-pickup-key">{item.accelerator})</span>
                      <span className="nh3d-pickup-text">{item.text}</span>
                    </div>
                  ),
                )}
                <div className="nh3d-pickup-confirm">
                  Press ENTER to confirm selection, or ESC to cancel
                </div>
              </>
            ) : (
              <>
                {question.menuItems.map((item, index) =>
                  item.isCategory ||
                  !item.accelerator ||
                  !String(item.accelerator).trim() ? (
                    <div className="nh3d-menu-category" key={`cat-${index}`}>
                      {item.text}
                    </div>
                  ) : (
                    <button
                      className="nh3d-menu-button"
                      key={`menu-${item.accelerator}-${index}`}
                      onClick={() =>
                        controller?.chooseQuestionChoice(String(item.accelerator))
                      }
                      type="button"
                    >
                      <span className="nh3d-menu-button-key">
                        {item.accelerator}){" "}
                      </span>
                      <span>{item.text}</span>
                    </button>
                  ),
                )}
              </>
            )
          ) : (
            <div
              className={`nh3d-choice-list${
                parsedQuestionChoices.length > 0 &&
                parsedQuestionChoices.every((choice) => choice.trim().length === 1)
                  ? " is-compact"
                  : ""
              }`}
            >
              {parsedQuestionChoices.map((choice) => (
                <button
                  className={`nh3d-choice-button${
                    choice === question.defaultChoice
                      ? " nh3d-choice-button-default"
                      : ""
                  }`}
                  key={choice}
                  onClick={() => controller?.chooseQuestionChoice(choice)}
                  type="button"
                >
                  {getQuestionChoiceLabel(choice, inventory.items)}
                </button>
              ))}
            </div>
          )}
          <div className="nh3d-dialog-hint">Press ESC to cancel</div>
        </div>
      ) : null}

      {directionQuestion ? (
        <div className="nh3d-dialog nh3d-dialog-direction is-visible" id="direction-dialog">
          <div className="nh3d-direction-text">{directionQuestion}</div>
          <div className="nh3d-direction-grid">
            {directionChoices.map((direction) => (
              <button
                className="nh3d-direction-button"
                key={direction.key}
                onClick={() => controller?.chooseDirection(direction.key)}
                type="button"
              >
                <div className="nh3d-direction-symbol">{direction.label}</div>
                <div className="nh3d-direction-key">{direction.key}</div>
              </button>
            ))}
          </div>
          <div className="nh3d-dialog-hint">
            Use numpad (1-9), arrow keys, or click a direction. Press ESC to cancel
          </div>
        </div>
      ) : null}

      {infoMenu ? (
        <div className="nh3d-dialog nh3d-dialog-info is-visible" id="info-menu-dialog">
          <div className="nh3d-info-title">{infoMenu.title || "NetHack Information"}</div>
          <div className="nh3d-info-body">
            {infoMenu.lines.length > 0 ? infoMenu.lines.join("\n") : "(No details)"}
          </div>
          <div className="nh3d-info-hint">Press ESC to close. Press Ctrl+M to reopen.</div>
        </div>
      ) : null}

      {inventory.visible ? (
        <div className="nh3d-dialog nh3d-dialog-inventory is-visible" id="inventory-dialog">
          <div className="nh3d-inventory-title">📦 INVENTORY</div>
          <div className="nh3d-inventory-items">
            {inventory.items.length === 0 ? (
              <div className="nh3d-inventory-empty">Your inventory is empty.</div>
            ) : (
              inventory.items.map((item, index) =>
                item.isCategory ? (
                  <div
                    className={`nh3d-inventory-category${
                      index === 0 ? " nh3d-inventory-category-first" : ""
                    }`}
                    key={`cat-${index}`}
                  >
                    {item.text}
                  </div>
                ) : (
                  <div className="nh3d-inventory-item" key={`item-${index}`}>
                    <span className="nh3d-inventory-key">{item.accelerator || "?"})</span>
                    <span className="nh3d-inventory-text">{item.text || "Unknown item"}</span>
                  </div>
                ),
              )
            )}
          </div>
          <div className="nh3d-inventory-keybinds-title">🎮 ITEM COMMANDS</div>
          <div className="nh3d-inventory-keybinds">
            <div className="nh3d-inventory-keybinds-text">
              <span className="nh3d-inventory-command-key">a</span>)pply{" "}
              <span className="nh3d-inventory-command-key">d</span>)rop{" "}
              <span className="nh3d-inventory-command-key">e</span>)at{" "}
              <span className="nh3d-inventory-command-key">q</span>)uaff{" "}
              <span className="nh3d-inventory-command-key">r</span>)ead{" "}
              <span className="nh3d-inventory-command-key">t</span>)hrow{" "}
              <span className="nh3d-inventory-command-key">w</span>)ield{" "}
              <span className="nh3d-inventory-command-key">W</span>)ear{" "}
              <span className="nh3d-inventory-command-key">T</span>)ake-off{" "}
              <span className="nh3d-inventory-command-key">P</span>)ut-on{" "}
              <span className="nh3d-inventory-command-key">R</span>)emove{" "}
              <span className="nh3d-inventory-command-key">z</span>)ap{" "}
              <span className="nh3d-inventory-command-key">Z</span>)cast{"\n"}
              Special: <span className="nh3d-inventory-command-key">"</span>)weapons{" "}
              <span className="nh3d-inventory-command-key">[</span>)armor{" "}
              <span className="nh3d-inventory-command-key">=</span>)rings{" "}
              <span className="nh3d-inventory-command-key">"</span>)amulets{" "}
              <span className="nh3d-inventory-command-key">(</span>)tools
            </div>
          </div>
          <div className="nh3d-inventory-close">Press ESC or 'i' to close</div>
        </div>
      ) : null}

      <div className={positionRequest ? "is-visible" : ""} id="position-dialog">
        {positionRequest}
      </div>

      <div className="controls">
        <div>
          <strong>Controls:</strong>
        </div>
        <div>Arrow Keys: Move</div>
        <div>Space: Wait</div>
        <div>Enter: Confirm</div>
        <div>Esc: Cancel/Menu</div>
      </div>
    </>
  );
}
