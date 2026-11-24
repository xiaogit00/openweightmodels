'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import {
  MAX_CATEGORIES_PER_COMPARISON,
  MAX_NEW_CATEGORIES_PER_COMPARISON,
  PRESET_CATEGORIES,
  categoryNameError,
  categorySlug,
  normaliseCategoryName,
  rankCategoryOptions,
  type CategoryOption,
  type CategoryRef,
  type SelectedCategory,
} from '@owm/core/client';
import { MicroLabel } from './ui/micro-label';
import { cn } from '@/lib/utils';

const FIELD_LABEL = 'text-[13px] font-medium text-neutral-200';
const FIELD_HINT = 'text-[12.5px] font-normal text-neutral-400';

const presetSlugs = new Set<string>(PRESET_CATEGORIES.map((entry) => entry.slug));

function selectedFromRef(
  ref: CategoryRef,
  library: CategoryOption[],
): SelectedCategory {
  const known = library.find((entry) => entry.slug === ref.slug);
  return {
    slug: ref.slug,
    name: known?.name ?? ref.name,
    featured: known?.featured ?? presetSlugs.has(ref.slug),
    isNew: !known && !presetSlugs.has(ref.slug),
  };
}

/** Builds a selection from stored Category refs, preserving click order. */
export function categorySelection(
  refs: CategoryRef[],
  library: CategoryOption[],
): SelectedCategory[] {
  return refs.map((ref) => selectedFromRef(ref, library));
}

/**
 * Step 3's Categories. Presets are always-visible toggles; every other
 * selection sits after them as a removable chip. The combobox browses the
 * community library, searches presets and community together, and creates a
 * name that does not exist yet. The server re-applies every cap on submit.
 */
export function CategoryPicker({
  library,
  value,
  onChange,
}: {
  library: CategoryOption[];
  value: SelectedCategory[];
  onChange: (next: SelectedCategory[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedSlugs = new Set(value.map((entry) => entry.slug));
  const newSelected = value.filter((entry) => entry.isNew);
  const presetOptions = PRESET_CATEGORIES.map(
    (entry) =>
      library.find((option) => option.slug === entry.slug) ?? {
        ...entry,
        featured: true,
        count: 0,
      },
  );
  const community = library.filter((entry) => !entry.featured);
  // A Category that lost its last Comparison stays at count 0 and is hidden
  // from Browse until it is used again. A selected one stays visible so it can
  // be removed.
  const browsableCommunity = community.filter(
    (entry) => entry.count > 0 || selectedSlugs.has(entry.slug),
  );
  const searchable = library.filter(
    (entry) => entry.featured || entry.count > 0 || selectedSlugs.has(entry.slug),
  );
  const extra = value.filter((entry) => !presetSlugs.has(entry.slug));

  const needle = normaliseCategoryName(query);
  const trimmed = needle.toLowerCase();
  const slugQuery = categorySlug(needle);
  const searching = trimmed.length > 0;
  const options = useMemo(
    () =>
      rankCategoryOptions(searching ? searchable : browsableCommunity, query, {
        own: newSelected,
      }),
    // The Derived arrays are stable enough for one render; the ranker is pure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, searchable, browsableCommunity, newSelected, query, searching],
  );

  const exactMatch = useMemo(
    () =>
      library.some(
        (entry) =>
          entry.slug === slugQuery ||
          entry.name.toLowerCase() === trimmed,
      ),
    [library, slugQuery, trimmed],
  );
  const nameError = searching ? categoryNameError(needle) : null;
  const canCreate =
    searching &&
    !exactMatch &&
    !nameError &&
    !selectedSlugs.has(slugQuery) &&
    newSelected.length < MAX_NEW_CATEGORIES_PER_COMPARISON &&
    value.length < MAX_CATEGORIES_PER_COMPARISON;
  const atNewCap = newSelected.length >= MAX_NEW_CATEGORIES_PER_COMPARISON;
  const atSelectionCap = value.length >= MAX_CATEGORIES_PER_COMPARISON;

  // The highlighted row wraps through the create row, matching the design.
  const rowCount = options.length + (canCreate ? 1 : 0);
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, rowCount - 1)));
  }, [rowCount]);

  function togglePreset(preset: { slug: string; name: string }) {
    if (selectedSlugs.has(preset.slug)) {
      onChange(value.filter((entry) => entry.slug !== preset.slug));
      return;
    }
    if (value.length >= MAX_CATEGORIES_PER_COMPARISON) return;
    onChange([
      ...value,
      { slug: preset.slug, name: preset.name, featured: true, isNew: false },
    ]);
  }

  function removeExtra(slug: string) {
    onChange(value.filter((entry) => entry.slug !== slug));
  }

  function choose(option: CategoryOption & { isNew?: boolean }) {
    if (selectedSlugs.has(option.slug)) {
      onChange(value.filter((entry) => entry.slug !== option.slug));
    } else if (value.length < MAX_CATEGORIES_PER_COMPARISON) {
      onChange([
        ...value,
        {
          slug: option.slug,
          name: option.name,
          featured: option.featured,
          isNew: Boolean(option.isNew),
        },
      ]);
    }
    setQuery('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function create() {
    if (!canCreate) return;
    const name = normaliseCategoryName(query);
    const slug = categorySlug(name);
    onChange([
      ...value,
      { slug, name, featured: false, isNew: true },
    ]);
    setQuery('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function focusOption(index: number) {
    setActive(index);
    requestAnimationFrame(() => {
      document
        .getElementById(`${listboxId}-row-${index}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        focusOption(rowCount ? (active + 1) % rowCount : 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        focusOption(rowCount ? (active - 1 + rowCount) % rowCount : 0);
        break;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        focusOption(0);
        break;
      case 'End':
        if (!open) return;
        event.preventDefault();
        focusOption(Math.max(0, rowCount - 1));
        break;
      case 'Enter':
        if (!open) {
          // Enter in a closed combobox must not submit the whole form.
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (active < options.length) choose(options[active]!);
        else if (canCreate) create();
        break;
      case 'Escape':
        event.preventDefault();
        if (query) {
          setQuery('');
          return;
        }
        if (open) setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const activeId = open && rowCount
    ? active < options.length
      ? `${listboxId}-row-${active}`
      : `${listboxId}-create`
    : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={FIELD_LABEL}>Categories</span>
        <span className={cn(FIELD_HINT, 'tabular-nums')}>
          {value.length} selected
        </span>
      </div>

      <div className="flex flex-wrap gap-2" data-category-chips>
        {presetOptions.map((preset) => {
          const selected = selectedSlugs.has(preset.slug);
          const disabled = !selected && atSelectionCap;
          return (
            <button
              key={preset.slug}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              data-category-preset={preset.slug}
              onClick={() => togglePreset(preset)}
              className={cn(
                'h-8 rounded-xs border px-3.5 text-[13px] font-medium transition-colors',
                selected
                  ? 'border-accent-600 bg-accent-900 text-accent-200'
                  : 'border-neutral-700 bg-transparent text-neutral-300 hover:border-accent-600',
                disabled && 'cursor-not-allowed opacity-45 hover:border-neutral-700',
              )}
            >
              {preset.name}
            </button>
          );
        })}

        {extra.map((entry) => (
          <span
            key={entry.slug}
            data-category-chip={entry.slug}
            className="flex h-8 items-center gap-1.5 rounded-xs border border-accent-600 bg-accent-900 py-0 pl-3 pr-1 text-[13px] font-medium text-accent-200"
          >
            {entry.isNew && (
              <span className="rounded-xs border border-accent-700 px-1 text-[9px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-accent-300">
                New
              </span>
            )}
            <span className="max-w-[180px] truncate">{entry.name}</span>
            <button
              type="button"
              aria-label={`Remove category ${entry.name}`}
              onClick={() => removeExtra(entry.slug)}
              className="grid h-[26px] w-[26px] place-items-center rounded-xs text-neutral-300 transition-colors hover:bg-accent-800 hover:text-text"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
      </div>

      <div className="relative w-full max-w-[420px]">
        <div
          className={cn(
            'flex h-9 items-center gap-2 rounded-xs border bg-bg px-3 text-neutral-400',
            open ? 'border-accent' : 'border-neutral-700',
          )}
        >
          <MagnifyingGlass size={15} aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Find or create a category"
            value={query}
            maxLength={24}
            placeholder="Find more categories, or create one…"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-text placeholder:text-neutral-400 focus-visible:outline-none"
          />
          {!searching && !open && (
            <span className={cn(FIELD_HINT, 'flex-none text-neutral-500')}>
              {presetOptions.length + browsableCommunity.length} categories
            </span>
          )}
        </div>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Categories"
            onMouseDown={(event) => event.preventDefault()}
            className="popover-surface absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-[320px] gap-0 overflow-y-auto p-1.5"
          >
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5">
              <MicroLabel>
                {searching ? 'MATCHING CATEGORIES' : 'BROWSE COMMUNITY CATEGORIES'}
              </MicroLabel>
              <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
                {searching ? '' : 'COMPARISONS'}
              </span>
            </div>

            {options.map((option, index) => {
              const selected = selectedSlugs.has(option.slug);
              return (
                <button
                  key={`${option.isNew ? 'new-' : ''}${option.slug}`}
                  id={`${listboxId}-row-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-category-option={option.slug}
                  tabIndex={-1}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex h-[34px] w-full items-center gap-2 rounded-xs px-2 text-left text-[13.5px] text-text transition-colors hover:bg-neutral-800',
                    index === active && 'bg-neutral-800',
                  )}
                >
                  <span className="grid h-4 w-4 flex-none place-items-center">
                    {selected && (
                      <Check size={13} weight="bold" className="text-accent-300" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.name}
                    {option.featured && (
                      <span className="ml-2 text-[11.5px] font-normal text-neutral-500">
                        Featured
                      </span>
                    )}
                    {option.isNew && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-300">
                        New
                      </span>
                    )}
                  </span>
                  <span
                    data-category-count
                    className="flex-none text-[12px] text-neutral-400"
                  >
                    {option.isNew ? 'New' : option.featured ? '' : option.count}
                  </span>
                </button>
              );
            })}

            {searching && options.length === 0 && (
              <p className="m-0 px-2 py-3 text-[13px] leading-[1.45] text-neutral-400">
                No categories match “{needle}”.
              </p>
            )}

            {!searching && browsableCommunity.length === 0 && newSelected.length === 0 && (
              <p className="m-0 px-2 py-3 text-[13px] leading-[1.45] text-neutral-400">
                No community categories to browse yet — type a name to create one.
              </p>
            )}

            {nameError && searching && (
              <p className="m-0 px-2 py-2 text-[12.5px] leading-[1.45] text-neutral-400">
                {nameError}
              </p>
            )}

            {canCreate && (
              <button
                id={`${listboxId}-create`}
                type="button"
                role="option"
                aria-selected={false}
                data-category-create
                tabIndex={-1}
                onClick={create}
                onMouseEnter={() => setActive(options.length)}
                className={cn(
                  'mt-1 flex h-[34px] w-full items-center gap-2 rounded-xs border-t border-neutral-800 px-2 pt-1 text-left text-[13.5px] text-text transition-colors hover:bg-neutral-800',
                  active === options.length && 'bg-neutral-800',
                )}
              >
                <Plus size={13} className="flex-none text-accent-300" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  Create “{normaliseCategoryName(query)}”
                </span>
                <span className="flex-none text-[12px] text-neutral-400">
                  New category
                </span>
              </button>
            )}

            {atNewCap &&
              !atSelectionCap &&
              searching &&
              !exactMatch &&
              !selectedSlugs.has(slugQuery) && (
                <p className="m-0 px-2 py-2 text-[12.5px] leading-[1.45] text-neutral-400">
                  You can create up to {MAX_NEW_CATEGORIES_PER_COMPARISON} new
                  categories per comparison.
                </p>
              )}

            {atSelectionCap && searching && (
              <p className="m-0 px-2 py-2 text-[12.5px] leading-[1.45] text-neutral-400">
                A comparison can have at most {MAX_CATEGORIES_PER_COMPARISON}{' '}
                categories.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
