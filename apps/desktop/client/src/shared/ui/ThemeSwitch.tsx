// Dark / Light switch for the main window (only Home places it). Applies and stores the theme via
// src/lib/theme.ts; the Tumbler and the approval window never apply a theme and stay dark.
import { useEffect, useState } from 'react';
import { currentTheme, onThemeChange, setTheme, type Theme } from '../../lib/theme';
import { Seg } from './components';

const OPTIONS = [
  { value: 'dark', label: 'Dark', title: 'The Dial palette' },
  { value: 'light', label: 'Light', title: 'PayPal palette' },
] as const;

export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, set] = useState<Theme>(currentTheme);
  useEffect(() => onThemeChange(set), []);
  return <Seg<Theme> label="Theme" value={theme} options={OPTIONS} onChange={setTheme} className={className} />;
}
