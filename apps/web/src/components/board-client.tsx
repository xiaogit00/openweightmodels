'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChatCircle,
  CheckCircle,
  Clock,
  Flame,
  GitDiff,
  Highlighter,
  Lightning,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';
import type { ComparisonCard } from '@owm/core/client';
import {
  CATEGORIES,
  EFFORT_LEVELS,
  SORTS,
  categoryCounts,
  filterCards,
  modelCounts,
  sortCards,
  type BoardFilters,
  type Sort,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonCardView } from './comparison-card';
import { cn } from '@/lib/utils';

type BoardModel = {
  id: string;
  slug: string;
  displayName: string;
  monogram: string;
  etaSeconds: number;
};

type TickerEvent = {
  id: number;
  kind: string;
  summary: string;
  createdAt: string;
};

type Props = {
  initialCards: ComparisonCard[];
  models: BoardModel[];
  events: TickerEvent[];
  handle: string;
  initialFilters: BoardFilters;
};

const EVENT_ICONS: Record<string, typeof GitDiff> = {
  'comparison.published': GitDiff,
  'annotation.created': Highlighter,
  'annotation.replied': ChatCircle,
  'comment.created': ChatCircle,
  'comment.replied': ChatCircle,
  'run.finished': CheckCircle,
};

export function BoardClient({ initialCards, models, events: initialEvents, handle, initialFilters }: Props) {
  const [items, setItems] = useState(initialCards);
  const [pending, setPending] = useState<ComparisonCard[]>([]);
  const [cat, setCat] = useState(initialFilters.cat);
  const [selectedModels, setSelectedModels] = useState<string[]>(initialFilters.models);
  const [effort, setEffort] = useState<number | null>(initialFilters.effort);
  const [sort, setSort] = useState<Sort>(initialFilters.sort);
  const [q, setQ] = useState(initialFilters.q);
  const [events, setEvents] = useState(initialEvents);
  const [newId, setNewId] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [live, setLive] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const filters: BoardFilters = { cat, models: selectedModels, effort, q, sort };

  const visible = useMemo(() => {
    const filtered = filterCards(items, filters);
    return sort === 'live' ? filtered : sortCards(filtered, sort);
  }, [items, cat, selectedModels, effort, q, sort]);

  const catCounts = useMemo(() => categoryCounts(items), [items]);
  const mCounts = useMemo(() => modelCounts(items), [items]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (cat !== 'All') url.searchParams.set('cat', cat);
    else url.searchParams.delete('cat');
    if (selectedModels.length) url.searchParams.set('models', selectedModels.join(','));
    else url.searchParams.delete('models');
    if (effort !== null) url.searchParams.set('effort', String(effort));
    else url.searchParams.delete('effort');
    if (sort !== 'live') url.searchParams.set('sort', sort);
    else url.searchParams.delete('sort');
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [cat, selectedModels, effort, sort, q]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQ('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/stream/board');
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as {
          type: string;
          data: Record<string, unknown> & { payload?: { card?: ComparisonCard } };
        };
        const activity = payload.data;
        if (payload.type === 'comparison.published' && activity.payload?.card) {
          const card = activity.payload.card;
          const shouldInsert =
            sort === 'live' && typeof window !== 'undefined' && window.scrollY < 200;
          if (shouldInsert) {
            setItems((current) =>
              current.some((item) => item.id === card.id) ? current : [card, ...current],
            );
            setNewId(card.id);
            setFlip((value) => !value);
          } else {
            setPending((current) =>
              current.some((item) => item.id === card.id) ? current : [card, ...current],
            );
          }
        }
        if (typeof activity.summary === 'string' && typeof activity.id === 'number') {
          setEvents((current) => [
            {
              id: activity.id as number,
              kind: payload.type,
              summary: activity.summary as string,
              createdAt: (activity.createdAt as string) ?? new Date().toISOString(),
            },
            ...current,
          ].slice(0, 30));
        }
      } catch {
        // ignore malformed event
      }
    };
    return () => source.close();
  }, [sort]);

  const chips: Array<{ label: string; remove: () => void }> = [];
  if (cat !== 'All') chips.push({ label: cat, remove: () => setCat('All') });
  for (const model of selectedModels) {
    const name = models.find((item) => item.slug === model)?.displayName ?? model;
    chips.push({
      label: name,
      remove: () => setSelectedModels(selectedModels.filter((value) => value !== model)),
    });
  }
  if (effort !== null) {
    chips.push({
      label: `${EFFORT_LEVELS[effort - 1]?.label ?? ''} effort`,
      remove: () => setEffort(null),
    });
  }

  const flush = () => {
    if (!pending.length) return;
    setItems((current) => [...pending, ...current]);
    setNewId(pending[0]?.id ?? null);
    setFlip((value) => !value);
    setPending([]);
  };

  const ticker = events.length ? [...events, ...events] : [];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        search={
          <label className="flex h-8 flex-[0_1_420px] items-center gap-2 rounded-[2px] border border-transparent bg-surface px-[10px] focus-within:border-neutral-700">
            <MagnifyingGlass size={15} className="text-neutral-400" />
            <input
              ref={searchRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search prompts or models"
              className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-text outline-0"
            />
            <span className="rounded-[2px] border border-neutral-700 px-[5px] py-[2px] text-[10px] font-medium text-neutral-500">
              /
            </span>
          </label>
        }
      />

      <div className="flex items-center gap-[14px] overflow-hidden whitespace-nowrap border-b border-neutral-800 px-5" style={{ height: 30 }}>
        <span className="flex flex-none items-center gap-[6px] text-[11px] font-medium text-accent-200">
          <span
            className={cn('h-[6px] w-[6px] rounded-[2px]', live ? 'bg-accent' : 'bg-neutral-500')}
            style={live ? { animation: 'pulse-soft 1.6s infinite' } : undefined}
          />
          {live ? 'LIVE' : 'RECONNECTING'}
        </span>
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="marquee flex flex-none gap-7">
            {ticker.map((event, index) => {
              const Icon = EVENT_ICONS[event.kind] ?? ChatCircle;
              return (
                <span
                  key={`${event.id}-${index}`}
                  className="flex flex-none items-center gap-[6px] text-[11px] font-normal text-neutral-400"
                >
                  <Icon size={12} />
                  <span className="text-neutral-200">{event.summary}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[216px_minmax(0,1fr)]">
        <aside className="sticky top-[82px] flex h-[calc(100vh-82px)] flex-col gap-[18px] self-start overflow-auto border-r border-neutral-800 px-3 py-4 pl-5">
          <div className="flex flex-col gap-px">
            <span className="micro-label px-2 pb-[6px]">CATEGORIES</span>
            {['All', ...CATEGORIES].map((category) => {
              const active = cat === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCat(category)}
                  className={cn(
                    'flex h-7 items-center justify-between rounded-[2px] px-2 text-left text-[12px] font-medium transition-colors hover:bg-surface',
                    active ? 'bg-surface text-text' : 'text-neutral-300',
                  )}
                >
                  <span>{category}</span>
                  <span className="text-[11px] font-normal text-neutral-500">
                    {category === 'All' ? items.length : (catCounts.get(category) ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-px">
            <div className="flex items-baseline justify-between px-2 pb-[6px]">
              <span className="micro-label">MODELS</span>
              {selectedModels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedModels([])}
                  className="text-[11px] font-medium text-accent-300"
                >
                  Clear
                </button>
              )}
            </div>
            {models.map((model) => {
              const checked = selectedModels.includes(model.slug);
              return (
                <button
                  key={model.slug}
                  type="button"
                  onClick={() =>
                    setSelectedModels((current) =>
                      checked
                        ? current.filter((value) => value !== model.slug)
                        : [...current, model.slug],
                    )
                  }
                  className="flex h-7 items-center gap-2 rounded-[2px] px-2 text-left text-[12px] font-medium text-neutral-200 transition-colors hover:bg-surface"
                >
                  <span
                    className={cn(
                      'grid h-[14px] w-[14px] flex-none place-items-center rounded-[2px] border',
                      checked ? 'border-accent bg-accent' : 'border-neutral-600 bg-transparent',
                    )}
                  >
                    {checked && <CheckCircle size={10} weight="fill" className="text-bg" />}
                  </span>
                  <span className="flex-1 truncate">{model.displayName}</span>
                  <span className="text-[11px] font-normal text-neutral-500">
                    {mCounts.get(model.slug) ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-[6px] px-2">
            <span className="micro-label">EFFORT</span>
            <div className="grid grid-cols-3 gap-[2px] rounded-[2px] bg-surface p-[2px]">
              {EFFORT_LEVELS.map((level) => {
                const active = effort === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setEffort(active ? null : level.value)}
                    className={cn(
                      'h-6 rounded-[2px] text-[11px] font-medium transition-colors',
                      active ? 'bg-neutral-700 text-text' : 'text-neutral-400',
                    )}
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-3 px-5 pb-8 pt-[14px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <div className="flex gap-[2px]">
              {SORTS.map((value) => {
                const meta = {
                  live: { label: 'Live', Icon: Lightning },
                  top: { label: 'Top', Icon: Flame },
                  new: { label: 'New', Icon: Clock },
                }[value];
                const active = sort === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSort(value);
                      if (value === 'live') {
                        setItems((current) => [...pending, ...current]);
                        setPending([]);
                      }
                    }}
                    className={cn(
                      'flex h-7 items-center gap-[5px] rounded-[2px] px-2.5 text-[12px] font-medium transition-colors hover:text-text',
                      active ? 'bg-surface text-text' : 'text-neutral-400',
                    )}
                  >
                    <meta.Icon size={13} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[12px] text-neutral-500">{visible.length} comparisons</span>
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={chip.remove}
                className="flex h-[22px] items-center gap-1 rounded-[2px] border border-neutral-700 px-1.5 text-[11px] font-medium text-neutral-200 transition-colors hover:border-accent"
              >
                {chip.label}
                <X size={10} />
              </button>
            ))}
            <div className="flex-1" />
            {pending.length > 0 && (
              <button
                type="button"
                onClick={flush}
                className="flex h-[26px] items-center gap-[5px] rounded-[2px] border border-accent bg-accent-900 px-2.5 text-[11px] font-medium text-accent-200"
              >
                <ArrowUp size={11} />
                {pending.length} new comparison{pending.length > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {visible.length > 0 ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}
            >
              {visible.map((card) => (
                <ComparisonCardView
                  key={card.id}
                  card={card}
                  href={`/comparisons/${card.id}`}
                  animation={newId === card.id ? (flip ? 'a' : 'b') : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 py-12">
              <span className="font-heading text-[14px] font-medium">No comparisons match</span>
              <button
                type="button"
                onClick={() => {
                  setCat('All');
                  setSelectedModels([]);
                  setEffort(null);
                  setQ('');
                }}
                className="text-[12px] font-medium text-accent-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </main>
      </div>

    </div>
  );
}
