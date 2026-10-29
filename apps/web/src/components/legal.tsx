import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

/**
 * The legal copy ships as a reviewed-shaped draft, not as final legal advice.
 * The banner and the bracketed placeholders must stay until an owner and a
 * lawyer sign it off (see docs/PRIVACY.md).
 */
export function LegalNotice() {
  return (
    <div
      role="note"
      className="mt-5 rounded-lg border border-danger/60 bg-surface p-3 text-[13px] leading-[1.55] text-neutral-300"
    >
      <strong className="font-medium text-danger">
        Draft for owner and legal review.
      </strong>{' '}
      This page describes how the product actually behaves today, but it is not legal
      advice and has not been reviewed. Replace the bracketed placeholders and remove
      this notice before launch.
    </div>
  );
}

export function LegalShell({
  title,
  updated,
  handle,
  signedIn,
  children,
}: {
  title: string;
  updated: string;
  handle: string | null;
  signedIn: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={handle} signedIn={signedIn} variant="page" showNew={false} />
      <main className="mx-auto w-full max-w-[680px] px-5 py-12">
        <div className="flex flex-col gap-1.5">
          <span className="micro-label uppercase">Legal</span>
          <h1 className="m-0 font-heading text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">
            {title}
          </h1>
          <p className="m-0 text-[12.5px] text-neutral-500">Last updated {updated}</p>
        </div>
        <LegalNotice />
        <div className="legal-prose mt-6 flex flex-col gap-6 text-[14.5px] leading-[1.65] text-neutral-300">
          {children}
        </div>
      </main>
    </div>
  );
}
