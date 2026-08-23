import type { BackgroundSettings } from '@/store/useSceneStore';

export type BackgroundMode = 'colour' | 'gradient' | 'image';

export interface BackgroundGradientPreset {
  id: string;
  color: string;
  color2: string;
  custom?: boolean;
}

export interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

export const BACKGROUND_GRADIENT_PRESETS: BackgroundGradientPreset[] = [
  { id: 'indigo', color: '#7386e8', color2: '#182768' },
  { id: 'sunset', color: '#ffad1f', color2: '#ff3c1f' },
  { id: 'lagoon', color: '#315f6b', color2: '#143841' },
  { id: 'plum', color: '#64267a', color2: '#32123f' },
  { id: 'blush', color: '#ffc1cd', color2: '#f4a8b7' },
  { id: 'graphite', color: '#47494b', color2: '#2c2e30' },
  { id: 'midnight', color: '#17182d', color2: '#4743a1' },
  { id: 'custom', color: '#706ee8', color2: '#31305f', custom: true },
];

export function backgroundMode(background: Pick<BackgroundSettings, 'source' | 'gradient'>): BackgroundMode {
  if (background.source === 'image') return 'image';
  if (background.source === 'color' && background.gradient) return 'gradient';
  return 'colour';
}

export function backgroundPatchForMode(
  mode: BackgroundMode,
  background?: Pick<BackgroundSettings, 'source' | 'gradient' | 'color' | 'color2'>,
): Partial<BackgroundSettings> {
  if (mode === 'gradient') {
    if (background) {
      const matchesPreset = BACKGROUND_GRADIENT_PRESETS.some((preset) =>
        !preset.custom
        && normalizeBackgroundHex(preset.color) === normalizeBackgroundHex(background.color)
        && normalizeBackgroundHex(preset.color2) === normalizeBackgroundHex(background.color2),
      );
      if (!matchesPreset) {
        const first = BACKGROUND_GRADIENT_PRESETS[0];
        return { source: 'color', gradient: true, color: first.color, color2: first.color2 };
      }
    }
    return { source: 'color', gradient: true };
  }
  if (mode === 'image') return { source: 'image' };
  return { source: 'color', gradient: false };
}

export function normalizeBackgroundHex(value: string, fallback = '#101014ff'): string {
  const raw = value.trim().toLowerCase();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{6}$/.test(normalized)) return `${normalized}ff`;
  // CSS shorthand is useful when typing directly in the field: #RGB and #RGBA.
  if (/^#[0-9a-f]{3,4}$/.test(normalized)) {
    const digits = normalized.slice(1);
    const expanded = digits.split('').map((digit) => `${digit}${digit}`).join('');
    return `#${expanded}${digits.length === 3 ? 'ff' : ''}`;
  }
  return fallback;
}

export function backgroundSourceForHex(value: string): BackgroundSettings['source'] {
  return normalizeBackgroundHex(value).endsWith('00') ? 'transparent' : 'color';
}

export function validateBackgroundImage(file: Pick<File, 'size' | 'type'>): string | null {
  if (!file.type.startsWith('image/')) return 'Choose an image file.';
  if (file.size > 5 * 1024 * 1024) return 'Image must be 5 MB or smaller.';
  return null;
}

export function hexToHsva(value: string): HsvaColor {
  const hex = normalizeBackgroundHex(value);
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const a = parseInt(hex.slice(7, 9), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
    a,
  };
}

export function hsvaToHex({ h, s, v, a }: HsvaColor): string {
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const value = Math.max(0, Math.min(100, v)) / 100;
  const chroma = value * saturation;
  const hue = ((h % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - chroma;
  let rgb: [number, number, number];

  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  const channel = (component: number) => Math.round((component + m) * 255).toString(16).padStart(2, '0');
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}${alpha}`;
}
