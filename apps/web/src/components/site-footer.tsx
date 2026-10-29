import Link from 'next/link';

/**
 * The public shell's footer. Legal links live here because anonymous readers
 * must be able to reach them without an account.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-800 p-6 text-[12px] text-neutral-400">
      <span>OpenWeightModels</span>
      <span aria-hidden>·</span>
      <Link href="/terms" className="text-neutral-300 hover:text-text">
        Terms
      </Link>
      <Link href="/privacy" className="text-neutral-300 hover:text-text">
        Privacy
      </Link>
      <span className="min-w-4 flex-1" />
      <span>Community comparisons of open-weight and frontier model outputs.</span>
    </footer>
  );
}
