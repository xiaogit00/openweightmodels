'use client';

import { Check, CircleHalf } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useEffect, useState } from 'react';
import { THEME_COOKIE, themeFromCookie, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { POPOVER_SURFACE } from './ui/popover-surface';

const OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function readCookie() {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
    return;
  }
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTheme(themeFromCookie(readCookie()));
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${
      60 * 60 * 24 * 365
    }; samesite=lax`;
    applyTheme(next);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Theme"
          className="btn-ghost h-8 w-8 rounded-[var(--r)] p-0"
        >
          <CircleHalf size={17} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Theme"
          className={cn(POPOVER_SURFACE, 'anim-pop-sm w-[160px] p-1')}
        >
          {OPTIONS.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => choose(option.value)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-[var(--r)] px-2 py-2 text-left text-[13px] transition-colors',
                  active
                    ? 'bg-surface font-medium text-text'
                    : 'text-neutral-300 hover:bg-surface',
                )}
              >
                {option.label}
                {active && (
                  <Check size={12} aria-hidden="true" className="text-accent-300" />
                )}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
