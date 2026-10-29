'use client';

import * as Popover from '@radix-ui/react-popover';
import { Bell } from '@phosphor-icons/react';
import { relativeTimeAgo } from '@owm/core/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  notificationHref,
  notificationLabel,
  type NotificationItem,
} from '@/lib/notifications';
import { POPOVER_SURFACE } from './ui/popover-surface';
import { MicroLabel } from './ui/micro-label';
import { cn } from '@/lib/utils';

type NotificationsResponse = {
  items: NotificationItem[];
  unread: number;
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Notifications failed: ${response.status}`);
      const payload = (await response.json()) as NotificationsResponse;
      setItems(payload.items);
      setUnread(payload.unread);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Load on mount, and again when the reader returns to the tab, so a Job that
  // settled while they were away shows an unread bell.
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const markRead = async (body: { id: string } | { all: true }) => {
    setUpdating(true);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Mark read failed: ${response.status}`);
    } catch {
      // Leave the unread dot in place; the next load shows the true server state.
    } finally {
      await load();
      setUpdating(false);
    }
  };

  // Relative times in an open panel refresh on the same one-minute beat as the Board.
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [open]);

  const openNotification = async (notification: NotificationItem) => {
    if (!notification.readAt) await markRead({ id: notification.id });
    setOpen(false);
    const href = notificationHref(notification);
    if (href) router.push(href);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setNow(Date.now());
      void load();
    }
  };

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="btn-ghost relative h-8 w-8 p-0"
        >
          <Bell size={17} />
          {unread > 0 && (
            <span
              aria-hidden="true"
              data-notification-dot
              className="absolute -right-1 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-accent"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Notifications"
          data-notification-panel
          className={cn(POPOVER_SURFACE, 'w-[310px]')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2.5">
            <MicroLabel>Notifications</MicroLabel>
            {unread > 0 && (
              <button
                type="button"
                disabled={updating}
                onClick={() => void markRead({ all: true })}
                className="rounded-[var(--r)] text-[13px] font-medium text-accent-300 hover:text-accent-200 disabled:opacity-60"
              >
                Mark all read
              </button>
            )}
          </div>

          {!loaded ? (
            <p className="px-3 py-4 text-[13px] text-neutral-400">Loading…</p>
          ) : failed ? (
            <div className="flex flex-col items-start gap-2 px-3 py-4">
              <p className="text-[13px] text-neutral-300">Couldn’t load notifications.</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-[13px] font-medium text-accent-300 hover:text-accent-200"
              >
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-1 px-3 py-5">
              <p className="text-[13px] font-medium text-neutral-100">You’re all caught up</p>
              <p className="text-[12px] text-neutral-400">
                Notifications appear when a job finishes.
              </p>
            </div>
          ) : (
            <ul className="flex max-h-[360px] flex-col overflow-y-auto p-1">
              {items.map((notification) => {
                const href = notificationHref(notification);
                const className = cn(
                  'flex w-full items-start gap-2 rounded-[var(--r)] px-2 py-2 text-left hover:bg-surface',
                  notification.readAt ? 'text-neutral-300' : 'text-text',
                );
                const body = (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-[6px] h-[6px] w-[6px] flex-none rounded-full',
                        notification.readAt ? 'bg-transparent' : 'bg-accent',
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-[2px]">
                      <span
                        className={cn(
                          'text-[13px] leading-[17px]',
                          notification.readAt ? '' : 'font-medium',
                        )}
                      >
                        {notificationLabel(notification)}
                      </span>
                      {notification.comparison && (
                        <span className="truncate text-[12px] text-neutral-400">
                          {notification.comparison.title}
                        </span>
                      )}
                      <span className="text-[11px] text-neutral-500">
                        {relativeTimeAgo(notification.createdAt, now)}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={notification.id}>
                    {href ? (
                      <Link
                        href={href}
                        data-notification-item
                        data-unread={notification.readAt ? 'false' : 'true'}
                        className={className}
                        onClick={(event) => {
                          event.preventDefault();
                          void openNotification(notification);
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        data-notification-item
                        data-unread={notification.readAt ? 'false' : 'true'}
                        className={className}
                        onClick={() => void openNotification(notification)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
