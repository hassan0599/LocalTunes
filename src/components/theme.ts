/**
 * localtunes design tokens: a dark, content-first look (near-black surfaces, bold white
 * type, pill controls) with a red accent. Dark only, like most music players.
 *
 * Contrast: text #FFFFFF / textMuted #B3B3B3 on bg #121212 pass WCAG AA; black text on
 * the accent (#E5484D, the logo red) is 6:1, so accent buttons use black labels.
 */
const dark = {
  bg: '#121212',
  /** Pressed rows, inputs, chips. */
  surface: '#242424',
  /** Cards and sheets that sit above the background. */
  elevated: '#2A2A2A',
  /** The tab bar and anything that should read as "the floor". */
  base: '#000000',
  text: '#FFFFFF',
  textMuted: '#B3B3B3',
  textFaint: '#7A7A7A',
  border: '#2E2E2E',
  accent: '#E5484D',
  accentPressed: '#C23A3F',
  onAccent: '#000000',
  /** Top of screen gradients: a red wash fading into bg. */
  heroTop: '#5C1520',
  /** Mini player card: a dark, red-tinted surface. */
  player: '#2B1519',
  danger: '#FF6B6B',
};

export type Theme = typeof dark;

export function useTheme(): Theme {
  return dark;
}

/** Minimum touch target (spec 8: 44 pt). */
export const TOUCH = 44;

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;

/** Stable, pleasant tile colour for a name (genre tiles, placeholders). */
export function tileColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const palette = ['#E8115B', '#8D67AB', '#1E3264', '#E13300', '#148A08', '#BA5D07', '#503750', '#27856A', '#477D95', '#AF2896', '#509BF5', '#B49BC8', '#DC148C', '#7358FF', '#E91429', '#0D73EC'];
  return palette[Math.abs(h) % palette.length];
}
