import { useColorScheme } from 'react-native';

const light = {
  bg: '#FFFFFF',
  surface: '#F3F3F6',
  text: '#121217',
  textMuted: '#6B6B76',
  border: '#E3E3E8',
  accent: '#6C4CF1',
  onAccent: '#FFFFFF',
  danger: '#D93636',
};

const dark: typeof light = {
  bg: '#0F0F13',
  surface: '#1C1C22',
  text: '#F2F2F5',
  textMuted: '#9C9CA8',
  border: '#2A2A32',
  accent: '#9C86FF',
  onAccent: '#14102B',
  danger: '#FF6B6B',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Minimum touch target (spec 8: 44 pt). */
export const TOUCH = 44;
