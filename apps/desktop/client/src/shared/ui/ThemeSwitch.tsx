// Dark / Light switch for the main window (only Home places it). Applies and stores the theme via
// src/lib/theme.ts; the Tumbler and the approval window follow the stored theme live (followStoredTheme).
import { useEffect, useState } from 'react';
import { currentTheme, onThemeChange, setTheme, type Theme } from '../../lib/theme';
import { UI_WORDS } from '../../lib/words';
import { Seg } from './components';

const OPTIONS = [
  { value: 'dark', label: UI_WORDS.theme.dark, title: UI_WORDS.theme.darkTitle },
  { value: 'light', label: UI_WORDS.theme.light, title: UI_WORDS.theme.lightTitle },
] as const;

export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, set] = useState<Theme>(currentTheme);
  useEffect(() => onThemeChange(set), []);
  return <Seg<Theme> label={UI_WORDS.theme.label} value={theme} options={OPTIONS} onChange={setTheme} className={className} />;
}
