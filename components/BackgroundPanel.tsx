'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackgroundSettings } from '../store/useSceneStore';
import {
  BACKGROUND_GRADIENT_PRESETS,
  backgroundMode,
  backgroundPatchForMode,
  backgroundSourceForHex,
  hexToHsva,
  hsvaToHex,
  normalizeBackgroundHex,
  validateBackgroundImage,
  type BackgroundMode,
  type HsvaColor,
} from '../lib/backgroundPanel';
import { GradientIcon, MediaIcon, PaletteIcon } from './EditorIcons';

const TAB_LABELS: Array<{ id: BackgroundMode; label: string; icon: typeof PaletteIcon }> = [
  { id: 'colour', label: 'Colour', icon: PaletteIcon },
  { id: 'gradient', label: 'Gradient', icon: GradientIcon },
  { id: 'image', label: 'Image', icon: MediaIcon },
];

function pickerPosition(value: HsvaColor) {
  return { left: `${value.s}%`, top: `${100 - value.v}%` };
}

export interface BackgroundPanelProps {
  background: BackgroundSettings;
  setBackground: (patch: Partial<BackgroundSettings>) => void;
}

export default function BackgroundPanel({ background, setBackground }: BackgroundPanelProps) {
  const mode = backgroundMode(background);
  const visibleHex = normalizeBackgroundHex(
    background.source === 'transparent'
      ? `${normalizeBackgroundHex(background.color).slice(0, 7)}00`
      : background.color,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(visibleHex);
  const [customGradient, setCustomGradient] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHexDraft(visibleHex), [visibleHex]);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [pickerOpen]);

  const hsva = useMemo(() => hexToHsva(visibleHex), [visibleHex]);
  const selectedPreset = BACKGROUND_GRADIENT_PRESETS.find((preset) =>
    !preset.custom
    && normalizeBackgroundHex(preset.color) === normalizeBackgroundHex(background.color)
    && normalizeBackgroundHex(preset.color2) === normalizeBackgroundHex(background.color2),
  );

  const selectMode = (nextMode: BackgroundMode) => {
    setBackground(backgroundPatchForMode(nextMode, background));
    setPickerOpen(false);
    if (nextMode !== 'gradient') setCustomGradient(false);
  };

  const commitColour = (nextValue: string) => {
    const normalized = normalizeBackgroundHex(nextValue, visibleHex);
    setHexDraft(normalized);
    setBackground({
      source: backgroundSourceForHex(normalized),
      gradient: false,
      color: normalized,
    });
  };

  const updatePicker = (patch: Partial<HsvaColor>) => {
    commitColour(hsvaToHex({ ...hsva, ...patch }));
  };

  const updateSaturation = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointermove' && event.buttons !== 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    updatePicker({ s: (x / rect.width) * 100, v: 100 - (y / rect.height) * 100 });
  };

  const uploadImage = (file: File | undefined) => {
    if (!file) return;
    const validation = validateBackgroundImage(file);
    if (validation) {
      setImageError(validation);
      return;
    }
    if (background.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(background.imageUrl);
    setBackground({ source: 'image', imageUrl: URL.createObjectURL(file) });
    setImageError(null);
  };

  const removeImage = () => {
    if (background.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(background.imageUrl);
    setBackground({ source: 'color', gradient: false, imageUrl: null });
    setImageError(null);
  };

  return (
    <div className="background-panel">
      <div className="background-tabs" role="tablist" aria-label="Background type">
        {TAB_LABELS.map((tab) => {
          const Icon = tab.icon;
          return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            data-background-tab={tab.id}
            className={`background-tab ${mode === tab.id ? 'active' : ''}`}
            onClick={() => selectMode(tab.id)}
          >
            <Icon size={13} />
            {tab.label}
          </button>
          );
        })}
      </div>

      {mode === 'colour' && (
        <div className="background-colour-panel">
          <div className="background-field-row">
            <label htmlFor="background-hex">Colour</label>
            <div className="background-colour-control" ref={pickerRef}>
              <input
                id="background-hex"
                className="background-hex-field"
                value={hexDraft}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                aria-label="Background colour with alpha"
                onChange={(event) => setHexDraft(event.target.value)}
                onBlur={() => commitColour(hexDraft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                }}
              />
              <button
                type="button"
                className="background-colour-swatch checkerboard"
                aria-label="Open background colour picker"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
              >
                <span style={{ backgroundColor: visibleHex }} />
              </button>

              {pickerOpen && (
                <div className="background-colour-picker" role="dialog" aria-label="Background colour picker">
                  <div
                    className="background-saturation"
                    style={{ '--picker-hue': `hsl(${hsva.h} 100% 50%)` } as React.CSSProperties}
                    onPointerDown={updateSaturation}
                    onPointerMove={updateSaturation}
                  >
                    <span className="background-picker-cursor" style={pickerPosition(hsva)} />
                  </div>
                  <label className="background-picker-slider hue">
                    <span className="sr-only">Hue</span>
                    <span className="background-slider-cursor" style={{ left: `${(hsva.h / 360) * 100}%` }} />
                    <input type="range" min="0" max="360" value={hsva.h} onChange={(event) => updatePicker({ h: Number(event.target.value) })} />
                  </label>
                  <label className="background-picker-slider alpha checkerboard">
                    <span className="sr-only">Opacity</span>
                    <span className="background-alpha-colour" style={{ '--alpha-colour': hsvaToHex({ ...hsva, a: 1 }) } as React.CSSProperties} />
                    <span className="background-slider-cursor" style={{ left: `${hsva.a * 100}%` }} />
                    <input type="range" min="0" max="100" value={Math.round(hsva.a * 100)} onChange={(event) => updatePicker({ a: Number(event.target.value) / 100 })} />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'gradient' && (
        <div className="background-gradient-panel">
          <div className="background-gradient-grid">
            {BACKGROUND_GRADIENT_PRESETS.map((preset) => {
              const active = preset.custom ? customGradient || !selectedPreset : selectedPreset?.id === preset.id && !customGradient;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`background-gradient-preset ${active ? 'active' : ''}`}
                  data-custom={preset.custom ? 'true' : undefined}
                  aria-label={preset.custom ? 'Custom gradient' : `${preset.id} gradient`}
                  aria-pressed={active}
                  style={{ background: `linear-gradient(135deg, ${preset.color}, ${preset.color2})` }}
                  onClick={() => {
                    setBackground({ source: 'color', gradient: true, ...(preset.custom ? {} : { color: preset.color, color2: preset.color2 }) });
                    setCustomGradient(Boolean(preset.custom));
                  }}
                >
                  {preset.custom && <span>Custom</span>}
                </button>
              );
            })}
          </div>

          {(customGradient || !selectedPreset) && (
            <div className="background-gradient-custom">
              <label>Start <input type="color" value={normalizeBackgroundHex(background.color).slice(0, 7)} onChange={(event) => setBackground({ color: `${event.target.value}ff` })} /></label>
              <label>End <input type="color" value={normalizeBackgroundHex(background.color2).slice(0, 7)} onChange={(event) => setBackground({ color2: `${event.target.value}ff` })} /></label>
            </div>
          )}
        </div>
      )}

      {mode === 'image' && (
        <div className="background-image-panel">
          {background.imageUrl && (
            <div className="background-image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={background.imageUrl} alt="Uploaded background" />
              <span>Uploaded</span>
            </div>
          )}
          <label className="background-image-upload">
            <input className="background-image-input" type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} />
            <span>Upload image (max 5 MB)</span>
          </label>
          {imageError && <p className="background-image-error" role="alert">{imageError}</p>}
          {background.imageUrl && (
            <button type="button" className="background-image-remove" onClick={removeImage}>Remove background image</button>
          )}
        </div>
      )}
    </div>
  );
}
