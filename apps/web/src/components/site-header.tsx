import Link from 'next/link';
import { ArrowLeft, Plus, SignIn } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { AccountMenu } from './account-menu';
import { Logo } from './logo';
import { NotificationBell } from './notification-bell';
import { ThemeControl } from './theme-control';

export function SiteHeader({
  handle,
  signedIn,
  variant = 'board',
  search,
  showNew = true,
  onNewHref = '/new',
  signInHref = '/sign-in',
}: {
  /** Null when the visitor is anonymous or has not chosen a handle yet. */
  handle: string | null;
  /** Overrides handle-based detection for sessions that still need onboarding. */
  signedIn?: boolean;
  variant?: 'board' | 'page';
  search?: ReactNode;
  showNew?: boolean;
  onNewHref?: string;
  signInHref?: string;
}) {
  const viewerSignedIn = signedIn ?? handle !== null;
  return (
    <header className="sticky top-0 z-20 flex min-h-[53px] flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-800 bg-bg px-6 py-[10px]">
      <Logo />
      {variant === 'page' && (
        <Link
          href="/"
          className="flex flex-none items-center gap-[5px] text-[13px] font-medium text-neutral-400 transition-colors hover:text-text"
        >
          <ArrowLeft size={13} aria-hidden />
          Board
        </Link>
      )}
      {search}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        {showNew && (
          <Link href={onNewHref} className="btn-primary">
            <Plus size={14} aria-hidden />
            New comparison
          </Link>
        )}
        <ThemeControl />
        {viewerSignedIn ? (
          <>
            <NotificationBell />
            <AccountMenu handle={handle} />
          </>
        ) : (
          <Link href={signInHref} className="btn-secondary">
            <SignIn size={14} aria-hidden />
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
