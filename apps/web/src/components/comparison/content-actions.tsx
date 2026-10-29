'use client';

import * as Popover from '@radix-ui/react-popover';
import { DotsThree, PencilSimple, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { ErrorLine } from './turn-state';

export const actionItemClass =
  'flex h-8 items-center gap-2 rounded-[var(--r)] px-2 text-left text-[13px] font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-45';

export const deleteButtonClass =
  'h-8 flex-1 rounded-[var(--r)] border border-danger px-2.5 text-[12.5px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-45';

/**
 * The one inline text editor used by annotation thread messages and Discussion
 * comments and replies. Escape in the textarea keeps the draft and moves focus
 * to Cancel; a second Escape discards it.
 */
export function InlineEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          // First Escape keeps the draft and moves to Cancel; a second Escape
          // (from Cancel) discards it deliberately.
          cancelRef.current?.focus();
        }}
        maxLength={5000}
        rows={3}
        autoFocus
        className="resize-y rounded-[var(--r)] border border-neutral-700 bg-bg px-2.5 py-2 text-[13.5px] leading-[1.5] text-text focus:border-accent"
      />
      {error && <ErrorLine message={error} />}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={onSave}
          className="btn-secondary h-8 disabled:opacity-45"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          ref={cancelRef}
          type="button"
          disabled={busy}
          onClick={onCancel}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }}
          className="btn-secondary h-8"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One kebab menu for owner-only content. Delete asks for confirmation in the
 * menu, then closes itself when the API accepts the change.
 */
export function ActionsMenu({
  label,
  noun,
  onEdit,
  onDelete,
}: {
  label: string;
  noun: string;
  onEdit: () => void;
  onDelete: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  };

  const cancelConfirm = () => {
    setConfirming(false);
    setError(null);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onDelete();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    close();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
          setError(null);
        } else {
          close();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-actions-trigger
          className="grid h-7 w-7 place-items-center rounded-[var(--r)] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-text"
        >
          <DotsThree size={18} weight="bold" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          data-popover
          data-actions-menu
          aria-label={`${noun} actions`}
          className="popover-surface z-50 w-[190px] gap-0.5 p-1.5"
        >
          {confirming ? (
            <>
              <span className="px-1.5 pb-2 pt-1 text-[12.5px] leading-[1.45] text-neutral-300">
                Delete this {noun}?
              </span>
              {error && (
                <span
                  className="px-1.5 pb-2 text-[12px] text-danger"
                  role="alert"
                >
                  {error}
                </span>
              )}
              <div className="flex gap-1.5">
                <button
                  ref={confirmRef}
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className={deleteButtonClass}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelConfirm}
                  className="btn-secondary h-8 flex-1"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  onEdit();
                }}
                className={actionItemClass}
              >
                <PencilSimple size={15} aria-hidden />
                Edit
              </button>
              <button
                ref={deleteRef}
                type="button"
                onClick={() => setConfirming(true)}
                className={actionItemClass}
              >
                <Trash size={15} aria-hidden />
                Delete
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
