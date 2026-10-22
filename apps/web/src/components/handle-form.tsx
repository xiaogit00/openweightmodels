'use client';

import { At, Check } from '@phosphor-icons/react';
import { HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH } from '@owm/core/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { safeNextPath } from '@/lib/next-path';

export function HandleForm({ next }: { next: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = handle.trim().toLowerCase();
    if (!candidate) {
      setError('Choose a handle.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/account/handle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: candidate }),
      });
      const payload = (await response.json()) as {
        user?: { handle: string | null };
        error?: { message?: string };
      };
      if (!response.ok || !payload.user?.handle) {
        setError(payload.error?.message ?? 'Could not save that handle.');
        return;
      }
      router.replace(safeNextPath(next));
      router.refresh();
    } catch {
      setError('Could not save that handle. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label htmlFor="handle" className="micro-label uppercase">
        Your handle
      </label>
      <div className="flex items-center gap-2 rounded-[2px] border border-neutral-700 bg-surface px-2.5 focus-within:border-accent">
        <At size={14} className="text-neutral-500" />
        <input
          id="handle"
          name="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={HANDLE_MAX_LENGTH}
          required
          placeholder="mira"
          aria-describedby="handle-rules"
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-[12px] text-text outline-0"
        />
        <span className="text-[11px] text-neutral-500">{handle.trim().length}/{HANDLE_MAX_LENGTH}</span>
      </div>
      <p id="handle-rules" className="m-0 text-[11px] leading-[1.55] text-neutral-500">
        {HANDLE_MIN_LENGTH}–{HANDLE_MAX_LENGTH} characters: lowercase letters, numbers, hyphens or
        underscores. It starts and ends with a letter or number. This is the only identity
        other people see; your email stays private.
      </p>
      {error && <p className="m-0 text-[11px] text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary h-9">
        <Check size={14} />
        {pending ? 'Saving…' : 'Claim handle and continue'}
      </button>
    </form>
  );
}
