'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import {
  EFFORT_LEVELS,
  type CategoryOption,
  type CategoryRef,
  type SelectedCategory,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { CategoryPicker, categorySelection } from './category-picker';
import { EffortGlyph } from './ui/effort-glyph';
import { cn } from '@/lib/utils';

const FIELD_LABEL = 'text-[13px] font-medium text-neutral-200';
const FIELD_HINT = 'text-[12.5px] font-normal text-neutral-400';
const FIELD_INPUT =
  'w-full rounded-xs border border-neutral-700 bg-bg px-3 text-[14px] text-text placeholder:text-neutral-400 focus:border-accent';

export function EditComparisonClient({
  comparison,
  library,
  handle,
}: {
  comparison: {
    id: string;
    title: string;
    categories: CategoryRef[];
    effort: number;
  };
  library: CategoryOption[];
  handle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(comparison.title);
  const [categories, setCategories] = useState<SelectedCategory[]>(() =>
    categorySelection(comparison.categories, library),
  );
  const [effort, setEffort] = useState(comparison.effort);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = title.trim().length > 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/comparisons/${comparison.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          categories: categories.map((category) => category.name),
          effort,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not save those details.');
        setSaving(false);
        return;
      }
      router.push(`/comparisons/${comparison.id}`);
    } catch {
      setError('Could not save those details. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={handle} variant="page" showNew={false} />

      <main className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-5 pb-16 pt-9 sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-heading text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">
            Edit details
          </h1>
          <span className="max-w-[600px] text-[14.5px] font-normal leading-[1.6] text-neutral-300">
            The prompt, Base output and Responses stay frozen. Title, Categories and
            Effort are yours to change.
          </span>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-5 rounded-lg border border-neutral-700 bg-bg p-6"
        >
          <label className="flex flex-col gap-2">
            <span className={cn('flex items-baseline justify-between gap-3', FIELD_LABEL)}>
              <span>Title</span>
              <span className={FIELD_HINT}>{title.length} / 200</span>
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              className={cn(FIELD_INPUT, 'h-[42px] px-3.5 text-[14.5px]')}
            />
          </label>

          <CategoryPicker
            library={library}
            value={categories}
            onChange={setCategories}
          />

          <div className="flex flex-col gap-2.5" role="group" aria-label="Effort level">
            <span className={FIELD_LABEL}>Effort level</span>
            <div className="grid grid-cols-3 gap-2">
              {EFFORT_LEVELS.map((level) => {
                const selected = effort === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setEffort(level.value)}
                    className={cn(
                      'flex flex-col items-start gap-1.5 rounded-xs border px-3.5 py-3 text-left transition-colors',
                      selected
                        ? 'border-accent-600 bg-accent-900'
                        : 'border-neutral-700 hover:border-accent-600',
                    )}
                  >
                    <span className="flex items-center gap-2 text-[14px] font-medium text-text">
                      <EffortGlyph effort={level.value} />
                      {level.label}
                    </span>
                    <span className="text-[12.5px] font-normal text-neutral-400">
                      {level.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="m-0 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-surface px-3.5 py-2.5 text-[13px] leading-[1.5] text-danger"
            >
              <WarningCircle size={14} className="mt-0.5 flex-none" aria-hidden />
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" disabled={!ready || saving} className="btn-primary h-9">
              {saving && <CircleNotch size={14} className="anim-spin" aria-hidden />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <Link
              href={`/comparisons/${comparison.id}`}
              className="btn-secondary h-9"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
