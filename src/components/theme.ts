/**
 * localtunes design tokens: cool "ink" surfaces (blue-tinted darks rather than neutral
 * greys), calm 700-weight type, generously rounded shapes and the logo red as the only
 * accent. Headers are flat; colour comes from artwork, not gradient washes. Dark only.
 *
 * Contrast on bg #0F1217: text 17:1, textMuted 8.0:1, textFaint 5.0:1 (AA); dark labels
 * on the accent (#E5484D, the logo red) are 5.0:1, so accent buttons use dark labels.
 */
const dark = {
  bg: '#0F1217',
  /** Pressed rows, inputs, segmented controls. */
  surface: '#1B2028',
  /** Cards and sheets that sit above the background; the selected segment. */
  elevated: '#252B35',
  /** Deepest layer (behind sheets). */
  base: '#0A0C10',
  text: '#F3F4F6',
  textMuted: '#A3AAB6',
  textFaint: '#7C8494',
  /** Hairlines: tab bar top edge, card outlines. */
  border: '#2A303B',
  accent: '#E5484D',
  accentPressed: '#C23A3F',
  onAccent: '#0B0D11',
  /** Top of album/player screens: a faint ink lift fading into bg (no colour wash). */
  heroTop: '#1A2030',
  /** Mini player card. */
  player: '#1B2028',
  danger: '#FF6B6B',
};

export type Theme = typeof dark;

export function useTheme(): Theme {
  return dark;
}

/** Minimum touch target (spec 8: 44 pt). */
export const TOUCH = 44;

export const radius = { sm: 6, md: 12, lg: 16, pill: 999 } as const;

/** Corner radius for square artwork: noticeably rounded (10% of the side), never under 6. */
export const artRadius = (size: number) => Math.max(6, Math.round(size * 0.1));

/**
 * localtunes' own tile palette (genre tiles, placeholders): twelve hues spaced evenly
 * around the wheel at one muted saturation/lightness, so tiles look like a family; each
 * is dark enough for white labels at AA (>= 4.6:1).
 */
const TILE_PALETTE = [
  '#B8434C', '#B5593B', '#9A6B28', '#7B762B', '#4C8147', '#2D8270',
  '#2C7A93', '#3768A8', '#5459B5', '#7150AD', '#91479A', '#AB4576',
];

/** Stable tile colour for a name. */
export function tileColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TILE_PALETTE[Math.abs(h) % TILE_PALETTE.length];
}

/** A darker shade of a #RRGGBB colour (0..1), for tile gradients. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
