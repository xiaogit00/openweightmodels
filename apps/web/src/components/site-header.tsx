import Link from 'next/link';
import { ArrowLeft, Bell, Plus } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { Avatar } from './avatar';
import { Logo } from './logo';

export function SiteHeader({
  handle,
  variant = 'board',
  search,
  showNew = true,
  onNewHref = '/new',
}: {
  handle: string;
  variant?: 'board' | 'page';
  search?: ReactNode;
  showNew?: boolean;
  onNewHref?: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-neutral-800 bg-bg px-5 py-[10px]">
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
      {variant === 'board' && (
        <button
          type="button"
          aria-label="Notifications"
          className="btn-ghost h-8 w-8 p-0"
        >
          <Bell size={17} />
        </button>
      )}
      <Avatar handle={handle} />
    </header>
  );
}
