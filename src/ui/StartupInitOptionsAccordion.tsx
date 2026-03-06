import type { ChangeEvent } from "react";
import {
  startupInitOptionDefinitions,
  type StartupInitOptionDefinition,
  type StartupInitOptionValue,
  type StartupInitOptionValues,
} from "../runtime/startup-init-options";

type StartupInitOptionsAccordionProps = {
  expanded: boolean;
  values: StartupInitOptionValues;
  onExpandedChange: (expanded: boolean) => void;
  onOptionValueChange: (key: string, value: StartupInitOptionValue) => void;
  onResetDefaults: () => void;
};

function renderBooleanOption(
  option: StartupInitOptionDefinition,
  values: StartupInitOptionValues,
  onOptionValueChange: (key: string, value: StartupInitOptionValue) => void,
): JSX.Element {
  const enabled = Boolean(values[option.key]);
  return (
    <div className="nh3d-option-row nh3d-option-row-inline-toggle" key={option.key}>
      <div className="nh3d-option-copy">
        <div className="nh3d-option-label">{option.label}</div>
        <div className="nh3d-option-description">{option.description}</div>
      </div>
      <button
        aria-checked={enabled}
        className={`nh3d-option-switch nh3d-option-inline-switch${
          enabled ? " is-on" : ""
        }`}
        onClick={() => onOptionValueChange(option.key, !enabled)}
        role="switch"
        type="button"
      >
        <span className="nh3d-option-switch-thumb" />
      </button>
    </div>
  );
}

function renderSelectOption(
  option: StartupInitOptionDefinition,
  values: StartupInitOptionValues,
  onOptionValueChange: (key: string, value: StartupInitOptionValue) => void,
): JSX.Element {
  if (option.control !== "select") {
    return <></>;
  }
  const selectedValue = String(values[option.key] ?? option.defaultValue);
  return (
    <div className="nh3d-option-row" key={option.key}>
      <div className="nh3d-option-copy">
        <div className="nh3d-option-label">{option.label}</div>
        <div className="nh3d-option-description">{option.description}</div>
      </div>
      <div className="nh3d-option-select-controls">
        <select
          className="nh3d-startup-config-select"
          onChange={(event) => onOptionValueChange(option.key, event.target.value)}
          value={selectedValue}
        >
          {option.options.map((selectOption) => (
            <option key={selectOption.value} value={selectOption.value}>
              {selectOption.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function renderTextOption(
  option: StartupInitOptionDefinition,
  values: StartupInitOptionValues,
  onOptionValueChange: (key: string, value: StartupInitOptionValue) => void,
): JSX.Element {
  if (option.control !== "text") {
    return <></>;
  }
  const textValue = String(values[option.key] ?? option.defaultValue);
  return (
    <div className="nh3d-option-row" key={option.key}>
      <div className="nh3d-option-copy">
        <div className="nh3d-option-label">{option.label}</div>
        <div className="nh3d-option-description">{option.description}</div>
      </div>
      <div className="nh3d-startup-init-option-input-shell">
        <input
          className="nh3d-startup-config-input"
          maxLength={option.maxLength}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onOptionValueChange(option.key, event.target.value)
          }
          placeholder={option.placeholder}
          type="text"
          value={textValue}
        />
      </div>
    </div>
  );
}

function renderNumberOption(
  option: StartupInitOptionDefinition,
  values: StartupInitOptionValues,
  onOptionValueChange: (key: string, value: StartupInitOptionValue) => void,
): JSX.Element {
  if (option.control !== "number") {
    return <></>;
  }
  const rawNumericValue = Number(values[option.key]);
  const numericValue = Number.isFinite(rawNumericValue)
    ? rawNumericValue
    : option.defaultValue;
  return (
    <div className="nh3d-option-row" key={option.key}>
      <div className="nh3d-option-copy">
        <div className="nh3d-option-label">{option.label}</div>
        <div className="nh3d-option-description">{option.description}</div>
      </div>
      <div className="nh3d-startup-init-option-input-shell">
        <input
          className="nh3d-startup-config-input"
          max={option.max}
          min={option.min}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const parsedValue = event.target.valueAsNumber;
            if (!Number.isFinite(parsedValue)) {
              onOptionValueChange(option.key, option.defaultValue);
              return;
            }
            onOptionValueChange(option.key, parsedValue);
          }}
          step={option.step}
          type="number"
          value={numericValue}
        />
      </div>
    </div>
  );
}

export default function StartupInitOptionsAccordion({
  expanded,
  values,
  onExpandedChange,
  onOptionValueChange,
  onResetDefaults,
}: StartupInitOptionsAccordionProps): JSX.Element {
  return (
    <details
      className="nh3d-startup-init-options"
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      open={expanded}
    >
      <summary className="nh3d-startup-init-options-summary">
        Initialization options (optional)
      </summary>
      <div className="nh3d-startup-init-options-body">
        <div className="nh3d-option-description nh3d-startup-init-options-description">
          Additional NetHack `OPTIONS` entries applied at startup. Window-port
          and platform-specific options are intentionally omitted.
        </div>
        <div className="nh3d-overflow-glow-frame">
          <div
            className="nh3d-startup-init-options-list"
            data-nh3d-overflow-glow
            data-nh3d-overflow-glow-host="parent"
          >
            {startupInitOptionDefinitions.map((option) => {
              if (option.control === "boolean") {
                return renderBooleanOption(option, values, onOptionValueChange);
              }
              if (option.control === "select") {
                return renderSelectOption(option, values, onOptionValueChange);
              }
              if (option.control === "text") {
                return renderTextOption(option, values, onOptionValueChange);
              }
              return renderNumberOption(option, values, onOptionValueChange);
            })}
          </div>
        </div>
        <div className="nh3d-startup-init-options-actions">
          <button
            className="nh3d-menu-action-button"
            onClick={onResetDefaults}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </details>
  );
}
