import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-text">
      <span className="grid h-[22px] w-[22px] place-items-center rounded-[2px] border-[1.5px] border-accent">
        <span className="h-3 w-2 border-r-[1.5px] border-accent" />
      </span>
      <span className="font-heading text-[14px] font-medium leading-none tracking-[-0.01em]">
        OpenWeightModels
      </span>
    </Link>
  );
}
