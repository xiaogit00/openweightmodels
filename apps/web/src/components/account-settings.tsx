'use client';

import { Download, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AccountSettings({ handle }: { handle: string | null }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmation.trim().toLowerCase() === 'delete';

  const remove = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? 'Could not delete your account. Try again.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-[2px] border border-neutral-800 bg-surface p-4">
        <h2 className="m-0 font-heading text-[14px] font-medium">Export your data</h2>
        <p className="m-0 mt-1.5 text-[12px] leading-[1.55] text-neutral-400">
          Download a JSON file with your account details, Comparisons, comments,
          Annotations, votes and notifications. Emails and content written by other
          people are never included.
        </p>
        <a href="/api/account/export" download className="btn-secondary mt-3">
          <Download size={13} />
          Download data
        </a>
      </section>

      <section className="rounded-[2px] border border-danger/60 bg-surface p-4">
        <h2 className="m-0 flex items-center gap-1.5 font-heading text-[14px] font-medium text-danger">
          <Warning size={15} />
          Delete account
        </h2>
        <p className="m-0 mt-1.5 text-[12px] leading-[1.55] text-neutral-300">
          This is permanent. Your email, {handle ? 'handle' : 'identity'} and sign-in
          sessions are erased. Published Comparisons stay on the Board attributed to{' '}
          <span className="text-neutral-100">[deleted]</span>. Your Discussion comments
          become tombstones so other people&rsquo;s replies stay readable; your Annotations
          are removed with their threads. Unpublished Comparisons are deleted. See the{' '}
          <Link href="/privacy">Privacy Policy</Link> for the full policy.
        </p>
        <label
          htmlFor="delete-confirmation"
          className="mt-3 block text-[11px] font-medium text-neutral-300"
        >
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 h-8 w-full max-w-[240px] rounded-[2px] border border-neutral-700 bg-bg px-2 text-[12px] text-text outline-0 focus-visible:border-accent"
        />
        {error && (
          <p role="alert" className="m-0 mt-2 text-[11px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void remove()}
            disabled={!confirmed || deleting}
            className="btn-neutral border-danger/60 text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </section>
    </div>
  );
}
