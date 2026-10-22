'use client';

import * as Popover from '@radix-ui/react-popover';
import { SignOut, User } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Avatar } from './avatar';

export function AccountMenu({ handle }: { handle: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      // Clear the development switcher too, so local sign-out really signs out.
      await fetch('/api/dev/user', { method: 'DELETE' }).catch(() => undefined);
      await authClient.signOut().catch(() => undefined);
      setOpen(false);
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const label = handle ? `Account menu for @${handle}` : 'Account menu';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`grid h-8 w-8 place-items-center rounded-[2px] outline-0 focus-visible:ring-2 focus-visible:ring-accent ${
            handle ? '' : 'border border-neutral-700 text-neutral-200'
          }`}
        >
          {handle ? <Avatar handle={handle} /> : <User size={16} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-40 flex w-[190px] flex-col rounded-[2px] border border-neutral-700 bg-neutral-800 p-1 shadow-lg"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            {handle ? <Avatar handle={handle} size={20} /> : <User size={16} />}
            <span className="truncate text-[12px] font-medium text-neutral-100">
              {handle ? `@${handle}` : 'Signed in'}
            </span>
          </div>
          <div className="my-1 h-px bg-neutral-700" />
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-[12px] text-neutral-200 outline-0 hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <SignOut size={13} />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
