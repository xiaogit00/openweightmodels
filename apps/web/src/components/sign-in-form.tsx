'use client';

import { EnvelopeSimple, PaperPlaneRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { MAGIC_LINK_TTL_MINUTES } from '@/lib/auth-constants';
import { safeNextPath } from '@/lib/next-path';

export function SignInForm({
  next,
  initialError,
}: {
  next: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);

  const requestLink = async (address: string) => {
    setPending(true);
    setError(null);
    try {
      const callbackURL = `/auth/complete?next=${encodeURIComponent(safeNextPath(next))}`;
      const result = await authClient.signIn.magicLink({ email: address, callbackURL });
      if (result.error) {
        setError(result.error.message ?? 'Could not send that link. Try again.');
        return;
      }
      setSentTo(address);
    } catch {
      setError('Could not send that link. Try again.');
    } finally {
      setPending(false);
    }
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-accent-200">
          <EnvelopeSimple size={16} />
          Check your inbox
        </div>
        <p className="m-0 text-[12px] leading-[1.55] text-neutral-300">
          We sent a single-use sign-in link to <span className="text-text">{sentTo}</span>.
          It expires in {MAGIC_LINK_TTL_MINUTES} minutes.
        </p>
        <p className="m-0 text-[11px] leading-[1.5] text-neutral-500">
          No mail? Check spam, or request another link. Locally, the link is also printed
          in the web server log when Mailpit is not running.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void requestLink(sentTo)}
            disabled={pending}
            className="btn-secondary h-8"
          >
            <PaperPlaneRight size={13} />
            {pending ? 'Sending…' : 'Send another link'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
            className="btn-ghost h-8"
          >
            Use a different email
          </button>
        </div>
        {error && <p className="m-0 text-[11px] text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const address = email.trim();
        if (!address) {
          setError('Enter your email address.');
          return;
        }
        void requestLink(address);
      }}
    >
      <label htmlFor="sign-in-email" className="micro-label uppercase">
        Email
      </label>
      <input
        id="sign-in-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="h-9 rounded-[2px] border border-neutral-700 bg-surface px-2.5 text-[12px] text-text outline-0 focus:border-accent"
      />
      <p className="m-0 text-[11px] leading-[1.5] text-neutral-500">
        We email a single-use link — no password. Your address is private; only your
        handle is public.
      </p>
      {error && <p className="m-0 text-[11px] text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary h-9">
        <PaperPlaneRight size={14} />
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      <p className="m-0 text-[11px] text-neutral-500">
        Reading is open to everyone. Sign in only when you want to write.{' '}
        <Link href="/" className="text-neutral-300 underline">
          Back to the Board
        </Link>
      </p>
    </form>
  );
}
