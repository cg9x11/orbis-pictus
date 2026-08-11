import { useEffect, useRef, useState } from "react";
import type { ModelSettings, ProviderOption } from "@orbis/shared";
import { pruneEmptyPrefs, type ModelPrefs } from "../lib/persistedPrefs";
import { classNames } from "../lib/classNames";
import { useDismiss } from "../hooks/useDismiss";

interface ModelSettingsPanelProps {
  settings: ModelSettings;
  prefs: ModelPrefs;
  onChange: (prefs: ModelPrefs) => void;
  disabled: boolean;
}

/** Sentinel for the "type your own model id" option. Not a model id, and never sent anywhere. */
const CUSTOM = "__custom__";

/** Must match `.model-settings-panel`'s width in styles.css - used to keep the panel on-screen. */
const PANEL_WIDTH = 320;

/** Shown as the empty choice everywhere: leaving a control alone means the server decides. */
function defaultLabel(current: string): string {
  return current ? `Server default (${current})` : "Server default";
}

interface FieldProps {
  label: string;
  disabled: boolean;
}

function ProviderField({
  label,
  options,
  current,
  value,
  onChange,
  disabled,
}: FieldProps & {
  options: ProviderOption[];
  current: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="model-settings-row">
      <span className="model-settings-label">{label}</span>
      <select
        className="style-picker-select"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{defaultLabel(current)}</option>
        {options.map((option) => (
          // A provider with no API key is offered but not selectable: the server would fall back and
          // say so, which works, but stopping it here saves a pointless round trip.
          <option key={option.name} value={option.name} disabled={!option.available}>
            {option.label}
            {option.available ? "" : " - no API key"}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A model chooser: known ids in a dropdown, plus a free-text escape hatch.
 *
 * The escape hatch is the point, not a nicety - provider model ids change faster than the server's
 * catalog can track. A typed id that the provider rejects is not fatal: the server retries on its
 * configured default and reports it back as a notice.
 */
function ModelField({
  label,
  models,
  current,
  value,
  onChange,
  disabled,
}: FieldProps & {
  models: string[];
  current: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const typed = value !== undefined && value !== "" && !models.includes(value);
  const [customMode, setCustomMode] = useState(typed);
  const showCustom = customMode || typed;

  return (
    <label className="model-settings-row">
      <span className="model-settings-label">{label}</span>
      <span className="model-settings-control">
        <select
          className="style-picker-select"
          value={showCustom ? CUSTOM : (value ?? "")}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              // Keep whatever is set until something is typed, so opening the box never silently
              // clears a working choice.
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            onChange(e.target.value || undefined);
          }}
        >
          <option value="">{defaultLabel(current)}</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {showCustom && (
          <input
            className="model-settings-input"
            type="text"
            value={typed ? value : ""}
            placeholder="model id"
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        )}
      </span>
    </label>
  );
}

function ChoiceField({
  label,
  choices,
  current,
  value,
  onChange,
  disabled,
}: FieldProps & {
  choices: string[];
  current: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <label className="model-settings-row">
      <span className="model-settings-label">{label}</span>
      <select
        className="style-picker-select"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{defaultLabel(current)}</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Picks the image and video provider/model at runtime, instead of editing `config.yml` and
 * restarting the server.
 *
 * A disclosure panel rather than more inline controls: the toolbar already carries eight and wraps.
 * The choices are remembered in this browser and ride along with every generate request, so the
 * server itself stays stateless and two tabs can use different models.
 *
 * Only affects pages generated from now on. Pages already drawn keep the model that drew them -
 * re-rendering would mean paying for every page again.
 */
export function ModelSettingsPanel({ settings, prefs, onChange, disabled }: ModelSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });

  /**
   * The panel is positioned `fixed`, not `absolute`, and so needs explicit coordinates.
   *
   * `.browser-frame` sets `overflow: hidden` to keep its rounded corners clean, which clipped an
   * absolutely-positioned panel at the frame's bottom edge - the last controls were unreachable.
   * A fixed element is not clipped by a plain `overflow: hidden` ancestor, so it can hang below the
   * frame. Kept on-screen by clamping against the viewport's right edge.
   */
  const placeUnderButton = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12)) });
  };

  // Outside-click + Escape dismiss (shared with the other popovers).
  useDismiss(open, () => setOpen(false), rootRef);

  // Reposition the fixed panel as the button under it moves. Separate from dismiss on purpose: the
  // panel is `fixed`, so its coordinates freeze at open time. A resize, or a scroll of the internally
  // scrolling `.browser-frame`, would otherwise strand it over unrelated content. Capture phase,
  // because that internal scroll never bubbles to `window`.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", placeUnderButton);
    window.addEventListener("scroll", placeUnderButton, true);
    return () => {
      window.removeEventListener("resize", placeUnderButton);
      window.removeEventListener("scroll", placeUnderButton, true);
    };
  }, [open]);

  // Nothing to offer until /api/config has answered - the same self-hiding rule ArtStylePicker uses
  // rather than rendering an empty control.
  if (settings.image.providers.length === 0) return null;

  const update = <K extends keyof ModelPrefs>(key: K, value: ModelPrefs[K]) => onChange({ ...prefs, [key]: value });

  /**
   * A model id belongs to exactly one provider, so it cannot survive the provider changing under it.
   * Left alone, picking OpenAI + `gpt-image-2` and then switching to fal sent `gpt-image-2` to fal
   * on every request: a rejection, a fallback retry, and a notice, once per page, forever - while
   * the panel still displayed the dead id in its Custom box as though it were in use.
   *
   * Only the model is cleared. The per-provider extras (image size, quality, Ark fallback) are read
   * solely by the factory they belong to, so they stay valid and come back if the user switches back.
   */
  const changeProvider = (providerKey: "image_provider" | "video_provider", modelKey: "image_model" | "video_model") =>
    (value: string | undefined) => onChange({ ...prefs, [providerKey]: value, [modelKey]: undefined });

  const changed = Object.keys(pruneEmptyPrefs(prefs)).length;

  // Extras belong to one provider each, so they only appear when that provider is the one in use.
  const activeImageProvider = prefs.image_provider ?? settings.image.provider;
  const activeVideoProvider = prefs.video_provider ?? settings.video.provider;

  /**
   * The "Server default (…)" hint names a real model id, and that id belongs to the provider the
   * SERVER is configured with. Once a different provider is picked, that id is not what leaving the
   * model alone would use - the server would use the newly-picked provider's own configured model.
   * So the hint is shown only while the picked provider still matches the server's.
   */
  const defaultModelFor = (picked: string, serverProvider: string, serverModel: string): string =>
    picked === serverProvider ? serverModel : "";

  return (
    <div className="model-settings" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={classNames("toolbar-button", { "toolbar-button-active": changed > 0 })}
        onClick={() => {
          if (!open) placeUnderButton();
          setOpen((v) => !v);
        }}
        title="Choose the image and video model used for new pages"
        aria-expanded={open}
      >
        ⚙ Models{changed > 0 ? ` (${changed})` : ""}
      </button>

      {open && (
        <div className="model-settings-panel" style={{ top: anchor.top, left: anchor.left }}>
          <p className="model-settings-title">Image</p>
          <ProviderField
            label="Provider"
            options={settings.image.providers}
            current={settings.image.provider}
            value={prefs.image_provider}
            onChange={changeProvider("image_provider", "image_model")}
            disabled={disabled}
          />
          <ModelField
            label="Model"
            models={settings.image.providers.find((p) => p.name === activeImageProvider)?.models ?? []}
            current={defaultModelFor(activeImageProvider, settings.image.provider, settings.image.model)}
            value={prefs.image_model}
            onChange={(v) => update("image_model", v)}
            disabled={disabled}
          />
          {activeImageProvider === "gemini" && (
            <ChoiceField
              label="Image size"
              choices={settings.extras.geminiImageSizes}
              current={settings.extras.geminiImageSize}
              value={prefs.gemini_image_size}
              onChange={(v) => update("gemini_image_size", v)}
              disabled={disabled}
            />
          )}
          {activeImageProvider === "openai" && (
            <ChoiceField
              label="Quality"
              choices={settings.extras.openaiImageQualities}
              current={settings.extras.openaiImageQuality}
              value={prefs.openai_image_quality}
              onChange={(v) => update("openai_image_quality", v)}
              disabled={disabled}
            />
          )}
          {activeImageProvider === "ark" && (
            <ModelField
              label="Fallback model"
              models={settings.image.providers.find((p) => p.name === "ark")?.models ?? []}
              current={settings.extras.arkFallbackModel}
              value={prefs.ark_fallback_model}
              onChange={(v) => update("ark_fallback_model", v)}
              disabled={disabled}
            />
          )}

          <p className="model-settings-title">Video</p>
          <ProviderField
            label="Provider"
            options={settings.video.providers}
            current={settings.video.provider}
            value={prefs.video_provider}
            onChange={changeProvider("video_provider", "video_model")}
            disabled={disabled}
          />
          <ModelField
            label="Model"
            models={settings.video.providers.find((p) => p.name === activeVideoProvider)?.models ?? []}
            current={defaultModelFor(activeVideoProvider, settings.video.provider, settings.video.model)}
            value={prefs.video_model}
            onChange={(v) => update("video_model", v)}
            disabled={disabled}
          />
          <ChoiceField
            label="Resolution"
            choices={settings.video.resolutions}
            current={settings.video.resolution}
            value={prefs.video_resolution}
            onChange={(v) => update("video_resolution", v)}
            disabled={disabled}
          />
          <label className="model-settings-row">
            <span className="model-settings-label">Seconds</span>
            <input
              className="model-settings-input"
              type="number"
              min={1}
              // `step` is not decoration: without it the spinner and validation both accept `5.5`,
              // which is not a whole number of seconds and which the server drops on arrival. The
              // control would then show a value that is not the one in effect.
              step={1}
              max={settings.video.maxDurationSeconds}
              placeholder={String(settings.video.durationSeconds)}
              value={prefs.video_duration_seconds ?? ""}
              disabled={disabled}
              // Empty clears the override rather than sending 0, which the server rejects outright.
              // Floored, not rounded: this number caps what a clip may spend, so it must never
              // resolve upwards to more than the user typed.
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                update("video_duration_seconds", e.target.value === "" || !Number.isFinite(n) || n <= 0 ? undefined : n);
              }}
            />
          </label>

          <p className="model-settings-note">
            Applies to new pages only. Video is capped at {settings.video.maxDurationSeconds}s per request.
          </p>
          <div className="model-settings-actions">
            <button type="button" className="toolbar-button" onClick={() => onChange({})} disabled={disabled || changed === 0}>
              Reset to server defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
