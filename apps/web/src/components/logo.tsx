import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="flex min-w-0 flex-none items-center gap-2 text-text">
      <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[var(--r)] border-[1.5px] border-accent">
        <span className="h-[10px] w-[1.5px] bg-accent" />
      </span>
      <span className="truncate font-heading text-[14px] font-medium leading-none tracking-[-0.01em]">
        OpenWeightModels
      </span>
    </Link>
  );
}
