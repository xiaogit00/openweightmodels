import Link from 'next/link';

/**
 * The public shell's footer. Legal links live here because anonymous readers
 * must be able to reach them without an account.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 px-5 py-4 text-[10.5px] tracking-[0.02em] text-neutral-500">
      <span>OpenWeightModels</span>
      <span aria-hidden>·</span>
      <Link href="/terms" className="text-neutral-400 hover:text-text">
        Terms
      </Link>
      <Link href="/privacy" className="text-neutral-400 hover:text-text">
        Privacy
      </Link>
      <span className="flex-1" />
      <span>Community comparisons of open-weight and frontier model outputs.</span>
    </footer>
  );
}
