import Link from 'next/link';
import { ArrowLeft, Plus, SignIn } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { AccountMenu } from './account-menu';
import { Logo } from './logo';
import { NotificationBell } from './notification-bell';

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
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-800 bg-bg px-5 py-[10px]">
      <Logo />
      {variant === 'page' && (
        <Link
          href="/"
          className="flex items-center gap-[5px] text-[12px] font-medium text-neutral-400 transition-colors hover:text-text"
        >
          <ArrowLeft size={13} />
          Board
        </Link>
      )}
      {search}
      <div className="flex-1" />
      {showNew && (
        <Link href={onNewHref} className="btn-primary h-8">
          <Plus size={14} />
          New comparison
        </Link>
      )}
      {viewerSignedIn ? (
        <>
          <NotificationBell />
          <AccountMenu handle={handle} />
        </>
      ) : (
        <Link href={signInHref} className="btn-secondary h-8">
          <SignIn size={14} />
          Sign in
        </Link>
      )}
    </header>
  );
}
