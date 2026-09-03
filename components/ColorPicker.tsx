'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

// Color conversions
function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length < 6) {
    return { r: 0, g: 0, b: 0 };
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hNorm = (h % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hNorm % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (hNorm >= 0 && hNorm < 1) { r = c; g = x; b = 0; }
  else if (hNorm >= 1 && hNorm < 2) { r = x; g = c; b = 0; }
  else if (hNorm >= 2 && hNorm < 3) { r = 0; g = c; b = x; }
  else if (hNorm >= 3 && hNorm < 4) { r = 0; g = x; b = c; }
  else if (hNorm >= 4 && hNorm < 5) { r = x; g = 0; b = c; }
  else if (hNorm >= 5 && hNorm < 6) { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hNorm = ((h % 360) + 360) % 360 / 360;
  const sNorm = clamp(s, 0, 100) / 100;
  const lNorm = clamp(l, 0, 100) / 100;

  if (sNorm === 0) {
    const val = Math.round(lNorm * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let val = t;
    if (val < 0) val += 1;
    if (val > 1) val -= 1;
    if (val < 1 / 6) return p + (q - p) * 6 * val;
    if (val < 1 / 2) return q;
    if (val < 2 / 3) return p + (q - p) * (2 / 3 - val) * 6;
    return p;
  };

  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;

  return {
    r: Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hNorm) * 255),
    b: Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255),
  };
}

export interface ColorPickerProps {
  color: string;
  alpha?: number; // 0..100
  showAlpha?: boolean;
  onChange: (color: string, alpha: number) => void;
}

export default function ColorPicker({
  color = '#000000',
  alpha = 100,
  showAlpha = true,
  onChange,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);

  // Format mode: HEX | RGB | HSL
  const [format, setFormat] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  // Normalize initial values
  const currentAlpha = (alpha !== undefined && alpha > 0 && alpha <= 1) ? Math.round(alpha * 100) : (alpha ?? 100);

  // Local color states
  const rgb = hexToRgb(color);
  const initialHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const initialHsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const [hsv, setHsv] = useState(initialHsv);
  const [hexInput, setHexInput] = useState(color);
  const [rInput, setRInput] = useState(String(rgb.r));
  const [gInput, setGInput] = useState(String(rgb.g));
  const [bInput, setBInput] = useState(String(rgb.b));
  const [hInput, setHInput] = useState(String(initialHsl.h));
  const [sInput, setSInput] = useState(String(initialHsl.s));
  const [lInput, setLInput] = useState(String(initialHsl.l));
  const [alphaInput, setAlphaInput] = useState(String(Math.round(currentAlpha)));

  // Synchronize when external color changes while closed
  useEffect(() => {
    if (!isOpen) {
      const { r, g, b } = hexToRgb(color);
      setHsv(rgbToHsv(r, g, b));
      const hslVal = rgbToHsl(r, g, b);
      setHexInput(color);
      setRInput(String(r));
      setGInput(String(g));
      setBInput(String(b));
      setHInput(String(hslVal.h));
      setSInput(String(hslVal.s));
      setLInput(String(hslVal.l));
      setAlphaInput(String(Math.round(currentAlpha)));
    }
  }, [color, currentAlpha, isOpen]);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target as Node)) {
        setFormatMenuOpen(false);
      }
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setFormatMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (formatMenuOpen) setFormatMenuOpen(false);
        else setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, formatMenuOpen]);

  const updateColorFromHsv = useCallback((newHsv: { h: number; s: number; v: number }, newAlpha = currentAlpha) => {
    setHsv(newHsv);
    const { r, g, b } = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
    const hex = rgbToHex(r, g, b);
    const hslVal = rgbToHsl(r, g, b);
    setHexInput(hex);
    setRInput(String(r));
    setGInput(String(g));
    setBInput(String(b));
    setHInput(String(hslVal.h));
    setSInput(String(hslVal.s));
    setLInput(String(hslVal.l));
    setAlphaInput(String(Math.round(newAlpha)));
    onChange(hex, newAlpha);
  }, [currentAlpha, onChange]);

  // Saturation / Value dragging
  const svAreaRef = useRef<HTMLDivElement>(null);
  const handleSvPointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    if (!svAreaRef.current) return;
    const rect = svAreaRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    updateColorFromHsv({
      h: hsv.h,
      s: x,
      v: 1 - y,
    });
  }, [hsv.h, updateColorFromHsv]);

  const onPointerDownSv = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleSvPointer(e);
    const onMove = (ev: PointerEvent) => handleSvPointer(ev);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Hue slider dragging
  const hueAreaRef = useRef<HTMLDivElement>(null);
  const handleHuePointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    if (!hueAreaRef.current) return;
    const rect = hueAreaRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const h = Math.round(x * 360) % 360;
    updateColorFromHsv({
      h,
      s: hsv.s,
      v: hsv.v,
    });
  }, [hsv.s, hsv.v, updateColorFromHsv]);

  const onPointerDownHue = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleHuePointer(e);
    const onMove = (ev: PointerEvent) => handleHuePointer(ev);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Alpha slider dragging
  const alphaAreaRef = useRef<HTMLDivElement>(null);
  const handleAlphaPointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    if (!alphaAreaRef.current) return;
    const rect = alphaAreaRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const a = Math.round(x * 100);
    setAlphaInput(String(a));
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    onChange(rgbToHex(r, g, b), a);
  }, [hsv, onChange]);

  const onPointerDownAlpha = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleAlphaPointer(e);
    const onMove = (ev: PointerEvent) => handleAlphaPointer(ev);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Commit hex input typing
  const commitHex = (val: string) => {
    const clean = val.trim().startsWith('#') ? val.trim() : `#${val.trim()}`;
    const { r, g, b } = hexToRgb(clean);
    const newHsv = rgbToHsv(r, g, b);
    setHsv(newHsv);
    const hex = rgbToHex(r, g, b);
    const hslVal = rgbToHsl(r, g, b);
    setHexInput(hex);
    setRInput(String(r));
    setGInput(String(g));
    setBInput(String(b));
    setHInput(String(hslVal.h));
    setSInput(String(hslVal.s));
    setLInput(String(hslVal.l));
    onChange(hex, currentAlpha);
  };

  // Commit RGB input typing
  const commitRgb = (rVal: string, gVal: string, bVal: string) => {
    const r = clamp(Math.round(Number(rVal) || 0), 0, 255);
    const g = clamp(Math.round(Number(gVal) || 0), 0, 255);
    const b = clamp(Math.round(Number(bVal) || 0), 0, 255);
    setRInput(String(r));
    setGInput(String(g));
    setBInput(String(b));
    const newHsv = rgbToHsv(r, g, b);
    setHsv(newHsv);
    const hex = rgbToHex(r, g, b);
    const hslVal = rgbToHsl(r, g, b);
    setHexInput(hex);
    setHInput(String(hslVal.h));
    setSInput(String(hslVal.s));
    setLInput(String(hslVal.l));
    onChange(hex, currentAlpha);
  };

  // Commit HSL input typing
  const commitHsl = (hVal: string, sVal: string, lVal: string) => {
    const h = ((Math.round(Number(hVal) || 0) % 360) + 360) % 360;
    const s = clamp(Math.round(Number(sVal) || 0), 0, 100);
    const l = clamp(Math.round(Number(lVal) || 0), 0, 100);
    setHInput(String(h));
    setSInput(String(s));
    setLInput(String(l));
    const { r, g, b } = hslToRgb(h, s, l);
    setRInput(String(r));
    setGInput(String(g));
    setBInput(String(b));
    const newHsv = rgbToHsv(r, g, b);
    setHsv(newHsv);
    const hex = rgbToHex(r, g, b);
    setHexInput(hex);
    onChange(hex, currentAlpha);
  };

  // Commit alpha input typing
  const commitAlpha = (val: string) => {
    const num = Number(val.replace('%', '').trim());
    if (Number.isFinite(num)) {
      const a = Math.round(clamp(num, 0, 100));
      setAlphaInput(String(a));
      onChange(color, a);
    } else {
      setAlphaInput(String(Math.round(currentAlpha)));
    }
  };

  // Current RGB for gradients
  const { r: curR, g: curG, b: curB } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const pureHueRgb = hsvToRgb(hsv.h, 1, 1);

  return (
    <div className="color-picker-root" ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger Row */}
      <div
        className="color-control-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--card-inset)',
          height: 'var(--ctl-h)',
          padding: '0 10px 0 6px',
          borderRadius: 'var(--r-ctrl)',
          cursor: 'pointer',
          border: isOpen ? '1px solid var(--fg)' : '1px solid transparent',
          userSelect: 'none',
        }}
      >
        {/* Swatch with transparency background */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--r-ctrl)',
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid var(--line)',
            flexShrink: 0,
            backgroundImage: `linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)`,
            backgroundSize: '8px 8px',
            backgroundColor: '#ffffff',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: color,
              opacity: currentAlpha / 100,
            }}
          />
        </div>

        {/* Color Hex and Opacity readout */}
        <span style={{ fontSize: 'var(--fs-ui)', fontFamily: 'monospace', color: 'var(--fg)', flex: 1 }}>
          {color.toUpperCase()}
        </span>
        {showAlpha && (
          <span style={{ fontSize: 'var(--fs-ui)', color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(currentAlpha)}%
          </span>
        )}
      </div>

      {/* Color Picker Popover Panel */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="color-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--card)',
            color: 'var(--fg)',
            borderRadius: 'var(--r-card, 0px)',
            border: '1px solid var(--line)',
            padding: 8,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* 1. 2D Saturation / Value Area (Color Square - Fully Square) */}
          <div
            ref={svAreaRef}
            onPointerDown={onPointerDownSv}
            style={{
              height: 125,
              borderRadius: 'var(--r-ctrl, 0px)',
              position: 'relative',
              cursor: 'crosshair',
              overflow: 'hidden',
              backgroundColor: `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`,
              touchAction: 'none',
              border: '1px solid var(--line)',
            }}
          >
            {/* White horizontal gradient */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to right, #ffffff, transparent)',
              }}
            />
            {/* Black vertical gradient */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to bottom, transparent, #000000)',
              }}
            />
            {/* Draggable Circle Handle */}
            <div
              style={{
                position: 'absolute',
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid #ffffff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.7)',
                backgroundColor: `rgb(${curR}, ${curG}, ${curB})`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </div>

          {/* 2. Hue Slider */}
          <div
            ref={hueAreaRef}
            onPointerDown={onPointerDownHue}
            style={{
              height: 12,
              borderRadius: 'var(--r-ctrl, 0px)',
              position: 'relative',
              cursor: 'pointer',
              background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
              touchAction: 'none',
              border: '1px solid var(--line)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${(hsv.h / 360) * 100}%`,
                top: '50%',
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid #ffffff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.7)',
                backgroundColor: `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </div>

          {/* 3. Alpha Slider (Inside the Color Panel!) */}
          {showAlpha && (
            <div
              ref={alphaAreaRef}
              onPointerDown={onPointerDownAlpha}
              style={{
                height: 12,
                position: 'relative',
                cursor: 'pointer',
                touchAction: 'none',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-ctrl, 0px)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 'var(--r-ctrl, 0px)',
                  overflow: 'hidden',
                  backgroundImage: `linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)`,
                  backgroundSize: '8px 8px',
                  backgroundColor: '#222',
                }}
              >
                {/* Alpha gradient ramp */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(to right, transparent, rgb(${curR}, ${curG}, ${curB}))`,
                  }}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: `${currentAlpha}%`,
                  top: '50%',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: '2px solid #ffffff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.7)',
                  backgroundColor: `rgba(${curR}, ${curG}, ${curB}, ${currentAlpha / 100})`,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          )}

          {/* 4. Bottom Controls: Format Selector (HEX / RGB / HSL) + Inputs + Alpha Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, position: 'relative', width: '100%', boxSizing: 'border-box' }}>
            {/* Format Dropdown Selector */}
            <div ref={formatMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setFormatMenuOpen((prev) => !prev)}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--fg)',
                  background: 'var(--card-inset)',
                  padding: '3px 5px',
                  borderRadius: 'var(--r-ctrl, 0px)',
                  border: '1px solid var(--line)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  height: 24,
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                }}
                title="Trocar formato de cor (HEX / RGB / HSL)"
              >
                {format} <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
              </button>

              {formatMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 4px)',
                    left: 0,
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-card, 0px)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                    zIndex: 10000,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 68,
                    overflow: 'hidden',
                  }}
                >
                  {(['HEX', 'RGB', 'HSL'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        setFormat(fmt);
                        setFormatMenuOpen(false);
                      }}
                      style={{
                        padding: '5px 8px',
                        fontSize: 10,
                        fontWeight: format === fmt ? 600 : 400,
                        textAlign: 'left',
                        background: format === fmt ? 'var(--card-inset)' : 'transparent',
                        color: format === fmt ? 'var(--fg)' : 'var(--fg-muted)',
                        border: 'none',
                        cursor: 'pointer',
                        borderRadius: 0,
                      }}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* HEX Input */}
            {format === 'HEX' && (
              <input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                onBlur={() => commitHex(hexInput)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitHex(hexInput); }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 24,
                  background: 'var(--card-inset)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-ctrl, 0px)',
                  padding: '2px 4px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--fg)',
                  textAlign: 'center',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}

            {/* RGB Inputs (R, G, B) */}
            {format === 'RGB' && (
              <div style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}>
                <input
                  type="text"
                  title="Red (0-255)"
                  placeholder="R"
                  value={rInput}
                  onChange={(e) => setRInput(e.target.value)}
                  onBlur={() => commitRgb(rInput, gInput, bInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRgb(rInput, gInput, bInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
                <input
                  type="text"
                  title="Green (0-255)"
                  placeholder="G"
                  value={gInput}
                  onChange={(e) => setGInput(e.target.value)}
                  onBlur={() => commitRgb(rInput, gInput, bInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRgb(rInput, gInput, bInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
                <input
                  type="text"
                  title="Blue (0-255)"
                  placeholder="B"
                  value={bInput}
                  onChange={(e) => setBInput(e.target.value)}
                  onBlur={() => commitRgb(rInput, gInput, bInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRgb(rInput, gInput, bInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* HSL Inputs (H, S, L) */}
            {format === 'HSL' && (
              <div style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}>
                <input
                  type="text"
                  title="Hue (0-360°)"
                  placeholder="H"
                  value={hInput}
                  onChange={(e) => setHInput(e.target.value)}
                  onBlur={() => commitHsl(hInput, sInput, lInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitHsl(hInput, sInput, lInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
                <input
                  type="text"
                  title="Saturation (0-100%)"
                  placeholder="S"
                  value={sInput}
                  onChange={(e) => setSInput(e.target.value)}
                  onBlur={() => commitHsl(hInput, sInput, lInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitHsl(hInput, sInput, lInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
                <input
                  type="text"
                  title="Lightness (0-100%)"
                  placeholder="L"
                  value={lInput}
                  onChange={(e) => setLInput(e.target.value)}
                  onBlur={() => commitHsl(hInput, sInput, lInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitHsl(hInput, sInput, lInput); }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 24,
                    background: 'var(--card-inset)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-ctrl, 0px)',
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: '2px 0',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Alpha % Input */}
            {showAlpha && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'var(--card-inset)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-ctrl, 0px)',
                  padding: '0 2px',
                  width: 40,
                  height: 24,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                <input
                  type="text"
                  title="Alpha (0-100%)"
                  value={alphaInput}
                  onChange={(e) => setAlphaInput(e.target.value)}
                  onBlur={() => commitAlpha(alphaInput)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitAlpha(alphaInput); }}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    fontSize: 10,
                    color: 'var(--fg)',
                    textAlign: 'center',
                    outline: 'none',
                    padding: 0,
                  }}
                />
                <span style={{ fontSize: 9, color: 'var(--fg-muted)', userSelect: 'none' }}>%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
