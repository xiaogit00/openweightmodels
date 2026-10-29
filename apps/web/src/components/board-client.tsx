'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChatCircle,
  CheckCircle,
  CircleNotch,
  Clock,
  Flame,
  GitDiff,
  Highlighter,
  Lightning,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';
import type { BoardFacets, BoardPage, ComparisonCard } from '@owm/core/client';
import {
  CATEGORIES,
  EFFORT_LEVELS,
  SORTS,
  addCardToFacets,
  appendUniqueCards,
  arrivalPlacement,
  boardFiltersKey,
  boardFiltersToSearchParams,
  matchesFilters,
  parseBoardFilters,
  type BoardFilters,
  type Sort,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonCardView } from './comparison-card';
import { MicroLabel } from './ui/micro-label';
import { SegmentedControl } from './ui/segmented-control';
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
  comparisonId?: string | null;
  payload?: Record<string, unknown>;
};

type BoardEvent = {
  id?: number;
  comparisonId?: string | null;
  summary?: string;
  createdAt?: string;
  payload?: Record<string, unknown> & { card?: ComparisonCard };
};

type Props = {
  initialPage: BoardPage;
  initialFacets: BoardFacets;
  models: BoardModel[];
  events: TickerEvent[];
  handle: string | null;
  signedIn: boolean;
  initialFilters: BoardFilters;
};

type CountField = 'commentCount' | 'annotationCount';

const EVENT_ICONS: Record<string, typeof GitDiff> = {
  'comparison.published': GitDiff,
  'annotation.created': Highlighter,
  'annotation.replied': ChatCircle,
  'comment.created': ChatCircle,
  'comment.replied': ChatCircle,
  'run.finished': CheckCircle,
};

async function requestPage(
  filters: BoardFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<BoardPage> {
  const params = boardFiltersToSearchParams(filters);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  const response = await fetch(query ? `/api/comparisons?${query}` : '/api/comparisons', {
    signal,
  });
  if (!response.ok) throw new Error(`Board request failed with ${response.status}`);
  return (await response.json()) as BoardPage;
}

function changeCount(
  cards: ComparisonCard[],
  id: string,
  field: CountField,
  delta: number,
) {
  let changed = false;
  const next = cards.map((card) => {
    if (card.id !== id) return card;
    changed = true;
    return { ...card, [field]: Math.max(0, card[field] + delta) };
  });
  return changed ? next : cards;
}

function retractTickerEvents(events: TickerEvent[], key: string, value: string) {
  return events.filter((event) => event.payload?.[key] !== value);
}

export function BoardClient({
  initialPage,
  initialFacets,
  models,
  events: initialEvents,
  handle,
  signedIn,
  initialFilters,
}: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [items, setItems] = useState(initialPage.items);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [facets, setFacets] = useState(initialFacets);
  const [phase, setPhase] = useState<'idle' | 'first' | 'more'>('idle');
  const [error, setError] = useState<{ kind: 'first' | 'more'; message: string } | null>(
    null,
  );
  const [pending, setPending] = useState<ComparisonCard[]>([]);
  const [events, setEvents] = useState(initialEvents);
  const [newId, setNewId] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const filterKey = boardFiltersKey(filters);
  const loadedKeyRef = useRef(filterKey);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const knownCardIdsRef = useRef(new Set(initialPage.items.map((card) => card.id)));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const patchFilters = useCallback((patch: Partial<BoardFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  // Filter, sort and search state lives in the URL. Defaults are omitted so a
  // pristine Board keeps a clean address.
  useEffect(() => {
    const query = boardFiltersToSearchParams(filters).toString();
    const target = `${window.location.pathname}${query ? `?${query}` : ''}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (target === current) return;

    const timer = setTimeout(() => {
      window.history.pushState(null, '', target);
    }, 180);
    return () => clearTimeout(timer);
  }, [filterKey, filters]);

  // Browser back/forward restores the view without a full navigation.
  useEffect(() => {
    const onPopState = () => {
      setFilters(parseBoardFilters(new URLSearchParams(window.location.search)));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
        setFilters((current) => ({ ...current, q: '' }));
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Starts a request and invalidates any older one. Only the newest sequence
  // number may write to state, so a slow response cannot overwrite a newer view.
  const beginRequest = useCallback(() => {
    const request = requestSeqRef.current + 1;
    requestSeqRef.current = request;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { request, signal: controller.signal };
  }, []);

  const loadFirstPage = useCallback(
    async (nextFilters: BoardFilters) => {
      const { request, signal } = beginRequest();
      setPhase('first');
      setError(null);

      try {
        const page = await requestPage(nextFilters, null, signal);
        if (request !== requestSeqRef.current) return;
        loadedKeyRef.current = boardFiltersKey(nextFilters);
        knownCardIdsRef.current = new Set(page.items.map((card) => card.id));
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setPending([]);
        setPhase('idle');
      } catch {
        if (request !== requestSeqRef.current || signal.aborted) return;
        setError({ kind: 'first', message: 'Could not load comparisons.' });
        setPhase('idle');
      }
    },
    [beginRequest],
  );

  // A filter change resets the keyset window. The 180ms debounce keeps typing
  // in the search box from issuing one request per keystroke. Returning to the
  // view that is already on screen cancels any request for the view in between.
  useEffect(() => {
    if (filterKey === loadedKeyRef.current) {
      requestSeqRef.current += 1;
      abortRef.current?.abort();
      setPhase('idle');
      setError(null);
      return;
    }

    // Block Load more during the debounce so an old cursor cannot fetch the
    // next page of the new view and append it to the old items.
    setPhase('first');
    setError(null);
    const timer = setTimeout(() => {
      void loadFirstPage(filtersRef.current);
    }, 180);
    return () => {
      clearTimeout(timer);
      requestSeqRef.current += 1;
      abortRef.current?.abort();
    };
  }, [filterKey, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || phase !== 'idle') return;

    const { request, signal } = beginRequest();
    setPhase('more');
    setError(null);

    try {
      const page = await requestPage(filtersRef.current, nextCursor, signal);
      if (request !== requestSeqRef.current) return;
      for (const card of page.items) knownCardIdsRef.current.add(card.id);
      setItems((current) => appendUniqueCards(current, page.items));
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setPhase('idle');
    } catch {
      if (request !== requestSeqRef.current || signal.aborted) return;
      setError({ kind: 'more', message: 'Could not load more comparisons.' });
      setPhase('idle');
    }
  }, [beginRequest, nextCursor, phase]);

  const refreshFacets = useCallback(async () => {
    try {
      const response = await fetch('/api/comparisons/facets');
      if (!response.ok) return;
      setFacets((await response.json()) as BoardFacets);
    } catch {
      // The live counts are cosmetic; the next reload repairs them.
    }
  }, []);

  // One subscription for the life of the page. Sort and filter changes only
  // update refs, so reconnecting resumes from the browser's Last-Event-ID.
  useEffect(() => {
    const after = initialEvents[0]?.id ?? 0;
    const source = new EventSource(
      after > 0 ? `/api/stream/board?after=${after}` : '/api/stream/board',
    );
    let opened = false;
    let lastSeen = after;

    source.onopen = () => {
      setLive(true);
      if (opened) void refreshFacets();
      opened = true;
    };
    source.onerror = () => setLive(false);
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as { type: string; data: BoardEvent };
        const activity = payload.data;
        if (typeof activity.id === 'number') {
          if (activity.id <= lastSeen) return;
          lastSeen = activity.id;
        }

        if (typeof activity.summary === 'string' && activity.summary && typeof activity.id === 'number') {
          setEvents((current) =>
            [
              {
                id: activity.id as number,
                kind: payload.type,
                summary: activity.summary as string,
                createdAt: activity.createdAt ?? new Date().toISOString(),
                comparisonId: activity.comparisonId ?? null,
                payload: activity.payload,
              },
              ...current,
            ].slice(0, 30),
          );
        }

        if (
          (payload.type === 'comparison.published' ||
            payload.type === 'comparison.restored') &&
          activity.payload?.card
        ) {
          const card = activity.payload.card;
          const activeFilters = filtersRef.current;

          if (!knownCardIdsRef.current.has(card.id)) {
            knownCardIdsRef.current.add(card.id);
            // Sidebar counts are global, so every publish counts even when the
            // card does not match the reader's current filters.
            setFacets((current) => addCardToFacets(current, card));

            if (matchesFilters(card, activeFilters)) {
              setTotal((current) => current + 1);
              const placement =
                typeof window === 'undefined'
                  ? 'queue'
                  : arrivalPlacement(activeFilters.sort, window.scrollY);
              if (placement === 'insert') {
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
          }
        }

        if (
          payload.type === 'comparison.takedown' &&
          typeof activity.comparisonId === 'string'
        ) {
          const comparisonId = activity.comparisonId;
          const wasLoaded = itemsRef.current.some((item) => item.id === comparisonId);
          knownCardIdsRef.current.delete(comparisonId);
          setItems((current) => current.filter((item) => item.id !== comparisonId));
          setPending((current) => current.filter((item) => item.id !== comparisonId));
          setEvents((current) =>
            current.filter((event) => event.comparisonId !== comparisonId),
          );
          if (wasLoaded) setTotal((current) => Math.max(0, current - 1));
          void refreshFacets();
        }

        if (
          payload.type === 'annotation.created' &&
          typeof activity.comparisonId === 'string'
        ) {
          setItems((current) =>
            changeCount(current, activity.comparisonId as string, 'annotationCount', 1),
          );
        }

        if (
          (payload.type === 'annotation.deleted' || payload.type === 'annotation.hidden') &&
          typeof activity.comparisonId === 'string'
        ) {
          setItems((current) =>
            changeCount(current, activity.comparisonId as string, 'annotationCount', -1),
          );
          const annotationId = activity.payload?.annotationId;
          if (typeof annotationId === 'string') {
            setEvents((current) => retractTickerEvents(current, 'annotationId', annotationId));
          }
        }

        if (
          payload.type === 'annotation.restored' &&
          typeof activity.comparisonId === 'string'
        ) {
          setItems((current) =>
            changeCount(current, activity.comparisonId as string, 'annotationCount', 1),
          );
        }

        if (
          (payload.type === 'comment.created' || payload.type === 'comment.replied') &&
          typeof activity.comparisonId === 'string'
        ) {
          setItems((current) =>
            changeCount(current, activity.comparisonId as string, 'commentCount', 1),
          );
        }

        if (
          (payload.type === 'comment.deleted' || payload.type === 'comment.hidden') &&
          typeof activity.comparisonId === 'string'
        ) {
          const amount =
            payload.type === 'comment.hidden' &&
            typeof activity.payload?.hiddenCount === 'number'
              ? activity.payload.hiddenCount
              : 1;
          setItems((current) =>
            changeCount(
              current,
              activity.comparisonId as string,
              'commentCount',
              -amount,
            ),
          );
          const commentId = activity.payload?.commentId;
          if (typeof commentId === 'string') {
            const hiddenIds = Array.isArray(activity.payload?.hiddenCommentIds)
              ? activity.payload.hiddenCommentIds.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [commentId];
            setEvents((current) =>
              hiddenIds.reduce(
                (events, id) => retractTickerEvents(events, 'commentId', id),
                current,
              ),
            );
          }
        }

        if (
          payload.type === 'comment.restored' &&
          typeof activity.comparisonId === 'string'
        ) {
          const amount =
            typeof activity.payload?.restoredCount === 'number'
              ? activity.payload.restoredCount
              : 1;
          setItems((current) =>
            changeCount(
              current,
              activity.comparisonId as string,
              'commentCount',
              amount,
            ),
          );
        }

        if (payload.type === 'annotation.message.deleted') {
          const messageId = activity.payload?.messageId;
          if (typeof messageId === 'string') {
            setEvents((current) => retractTickerEvents(current, 'messageId', messageId));
          }
        }

        // An account was deleted. Its comments and Annotations became
        // tombstones, so drop their counts and ticker lines without a reload.
        if (payload.type === 'account.deleted' && typeof activity.comparisonId === 'string') {
          const comparisonId = activity.comparisonId;
          const idsIn = (key: string) =>
            Array.isArray(activity.payload?.[key])
              ? (activity.payload[key] as unknown[]).filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
          const commentIds = idsIn('commentIds');
          const annotationIds = idsIn('annotationIds');
          const messageIds = idsIn('messageIds');
          const numberIn = (key: string, fallback: number) =>
            typeof activity.payload?.[key] === 'number'
              ? (activity.payload[key] as number)
              : fallback;
          const commentDelta = numberIn('commentCount', commentIds.length);
          const annotationDelta = numberIn('annotationCount', annotationIds.length);

          if (commentDelta) {
            setItems((current) =>
              changeCount(current, comparisonId, 'commentCount', -commentDelta),
            );
          }
          if (annotationDelta) {
            setItems((current) =>
              changeCount(
                current,
                comparisonId,
                'annotationCount',
                -annotationDelta,
              ),
            );
          }
          setEvents((current) => {
            let next = current;
            for (const id of commentIds) next = retractTickerEvents(next, 'commentId', id);
            for (const id of annotationIds) {
              next = retractTickerEvents(next, 'annotationId', id);
            }
            for (const id of messageIds) next = retractTickerEvents(next, 'messageId', id);
            return next;
          });
        }

        // A Challenger added to a published Comparison settles into the live
        // card without a second publish. Replace the loaded card in place and
        // refresh the global sidebar counts.
        if (payload.type === 'run.finished' && activity.payload?.card) {
          const card = activity.payload.card;
          setItems((current) => current.map((item) => (item.id === card.id ? card : item)));
          setPending((current) => current.map((item) => (item.id === card.id ? card : item)));
          void refreshFacets();
        }
      } catch {
        // Ignore malformed events; the next replay or reload repairs the view.
      }
    };

    return () => source.close();
  }, [initialEvents, refreshFacets]);

  const chips: Array<{ label: string; remove: () => void }> = [];
  if (filters.cat !== 'All') {
    chips.push({ label: filters.cat, remove: () => patchFilters({ cat: 'All' }) });
  }
  for (const model of filters.models) {
    const name = models.find((item) => item.slug === model)?.displayName ?? model;
    chips.push({
      label: name,
      remove: () =>
        setFilters((current) => ({
          ...current,
          models: current.models.filter((value) => value !== model),
        })),
    });
  }
  if (filters.effort !== null) {
    chips.push({
      label: `${EFFORT_LEVELS[filters.effort - 1]?.label ?? ''} effort`,
      remove: () => patchFilters({ effort: null }),
    });
  }

  const flush = () => {
    if (!pending.length) return;
    window.scrollTo({
      top: 0,
      behavior: reducedMotionRef.current ? 'auto' : 'smooth',
    });

    // A Top arrival cannot be placed without re-ranking, so let the server
    // apply the new order. Live and New arrivals genuinely belong at the top.
    if (filters.sort === 'top') {
      void loadFirstPage(filters);
      return;
    }

    const ids = new Set(pending.map((card) => card.id));
    setItems((current) => [...pending, ...current.filter((card) => !ids.has(card.id))]);
    setNewId(pending[0]?.id ?? null);
    setFlip((value) => !value);
    setPending([]);
  };

  const retry = () => {
    if (error?.kind === 'more') void loadMore();
    else void loadFirstPage(filters);
  };

  const clearFilters = () => {
    setFilters(parseBoardFilters(new URLSearchParams()));
  };

  useEffect(() => {
    const node = sentinelRef.current;
    if (
      !node ||
      !nextCursor ||
      phase !== 'idle' ||
      error ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, loadMore, nextCursor, phase]);

  const tickerEvents = events.filter((event) => event.summary);
  // The ticker needs a duplicated list to loop seamlessly. Reduced motion
  // renders one static pass so the reader does not get a repeated sentence.
  const ticker = tickerEvents.length
    ? reducedMotion
      ? tickerEvents
      : [...tickerEvents, ...tickerEvents]
    : [];
  const loadingFirst = phase === 'first';
  const loadingMore = phase === 'more';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        signedIn={signedIn}
        search={
          <label className="flex h-8 min-w-[120px] max-w-[440px] flex-[1_1_120px] items-center gap-2 rounded-[var(--r)] border border-neutral-800 bg-surface px-3 focus-within:border-neutral-700">
            <MagnifyingGlass size={15} className="flex-none text-neutral-400" aria-hidden />
            <input
              ref={searchRef}
              value={filters.q}
              onChange={(event) => patchFilters({ q: event.target.value })}
              placeholder="Search prompts or models"
              aria-label="Search comparisons"
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text"
            />
            <span className="hidden flex-none rounded-[var(--r)] border border-neutral-700 px-[5px] py-[2px] font-mono text-[11px] font-medium text-neutral-400 sm:block">
              /
            </span>
          </label>
        }
      />

      <div
        className="flex items-center gap-[14px] overflow-hidden whitespace-nowrap border-b border-neutral-800 px-5"
        style={{ height: 30 }}
      >
        <span className="flex flex-none items-center gap-[6px] text-[11px] font-medium text-accent-200">
          <span
            className={cn(
              'h-[6px] w-[6px] rounded-[2px]',
              live ? 'bg-accent' : 'bg-neutral-500',
              live && !reducedMotion && 'anim-pulse',
            )}
          />
          {live ? 'LIVE' : 'RECONNECTING'}
        </span>
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div
            className={cn('flex flex-none gap-7', !reducedMotion && 'anim-tick')}
            data-ticker
          >
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

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[216px_minmax(0,1fr)]">
        <aside
          aria-label="Board filters"
          className="flex flex-col gap-[18px] overflow-auto border-b border-neutral-800 px-5 py-4 lg:sticky lg:top-[83px] lg:h-[calc(100vh-83px)] lg:self-start lg:border-b-0 lg:border-r lg:px-3 lg:py-4 lg:pl-5">
          <div className="grid grid-cols-2 gap-px lg:flex lg:flex-col">
            <MicroLabel className="col-span-2 px-2 pb-[6px] lg:col-span-1">
              CATEGORIES
            </MicroLabel>
            {['All', ...CATEGORIES].map((category) => {
              const active = filters.cat === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patchFilters({ cat: category })}
                  className={cn(
                    'flex h-7 min-w-0 items-center justify-between rounded-[2px] px-2 text-left text-[12px] font-medium transition-colors hover:bg-surface',
                    active ? 'bg-surface text-text' : 'text-neutral-300',
                  )}
                >
                  <span>{category}</span>
                  <span className="text-[11px] font-normal text-neutral-500">
                    {category === 'All'
                      ? facets.total
                      : (facets.categories[category] ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-px lg:flex lg:flex-col">
            <div className="col-span-2 flex items-baseline justify-between px-2 pb-[6px] lg:col-span-1">
              <MicroLabel>MODELS</MicroLabel>
              {filters.models.length > 0 && (
                <button
                  type="button"
                  onClick={() => patchFilters({ models: [] })}
                  className="text-[11px] font-medium text-accent-300"
                >
                  Clear
                </button>
              )}
            </div>
            {models.map((model) => {
              const checked = filters.models.includes(model.slug);
              return (
                <button
                  key={model.slug}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      models: checked
                        ? current.models.filter((value) => value !== model.slug)
                        : [...current.models, model.slug],
                    }))
                  }
                  className="flex h-7 min-w-0 items-center gap-2 rounded-[2px] px-2 text-left text-[12px] font-medium text-neutral-200 transition-colors hover:bg-surface"
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
                    {facets.models[model.slug] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-[6px] px-2">
            <MicroLabel>EFFORT</MicroLabel>
            <SegmentedControl
              label="Effort filter"
              className="grid grid-cols-3"
              stretch
              value={filters.effort}
              options={EFFORT_LEVELS.map((level) => ({
                value: level.value,
                label: level.label,
              }))}
              onChange={(value) =>
                patchFilters({ effort: filters.effort === value ? null : value })
              }
            />
          </div>
        </aside>

        <main
          className="flex min-w-0 flex-col gap-3 px-5 pb-8 pt-[14px]"
          aria-busy={loadingFirst}
        >
          <h1 className="sr-only">Board</h1>
          <div className="flex flex-wrap items-center gap-[10px]">
            <div className="flex gap-[2px]">
              {SORTS.map((value) => {
                const meta = {
                  live: { label: 'Live', Icon: Lightning },
                  top: { label: 'Top', Icon: Flame },
                  new: { label: 'New', Icon: Clock },
                }[value];
                const active = filters.sort === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (value !== filters.sort) {
                        patchFilters({ sort: value as Sort });
                      } else if (pending.length > 0) {
                        flush();
                      } else {
                        // Re-clicking the active sort refetches page one, which
                        // is how a Top view applies the counts updated in place.
                        void loadFirstPage(filters);
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
            <span className="text-[12px] text-neutral-500" aria-live="polite">
              {total} comparison{total === 1 ? '' : 's'}
            </span>
            {loadingFirst && (
              <span className="flex items-center gap-[5px] text-[11px] text-neutral-400">
                <CircleNotch size={11} className="anim-spin" />
                Loading…
              </span>
            )}
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

          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-[2px] border border-neutral-700 bg-surface px-3 py-2 text-[12px] text-neutral-200"
            >
              <span>{error.message}</span>
              <button
                type="button"
                onClick={retry}
                className="text-[12px] font-medium text-accent-300"
              >
                Retry
              </button>
            </div>
          )}

          {items.length > 0 ? (
            <div
              className={cn(
                'grid gap-2 transition-opacity',
                loadingFirst && 'opacity-50',
              )}
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}
            >
              {items.map((card) => (
                <ComparisonCardView
                  key={card.id}
                  card={card}
                  now={now}
                  href={`/comparisons/${card.id}`}
                  animation={
                    !reducedMotion && newId === card.id ? (flip ? 'a' : 'b') : undefined
                  }
                />
              ))}
            </div>
          ) : loadingFirst ? (
            <div
              role="status"
              className="flex items-center gap-2 py-12 text-[12px] text-neutral-400"
            >
              <CircleNotch size={13} className="anim-spin" />
              Loading comparisons…
            </div>
          ) : error ? null : (
            <div className="flex flex-col items-start gap-2 py-12">
              <span className="font-heading text-[14px] font-medium">No comparisons match</span>
              <button
                type="button"
                onClick={clearFilters}
                className="text-[12px] font-medium text-accent-300"
              >
                Clear filters
              </button>
            </div>
          )}

          <div
            ref={sentinelRef}
            aria-hidden="true"
            data-testid="board-sentinel"
            className="h-px w-full"
          />
          {nextCursor && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={phase !== 'idle'}
                className="btn-secondary"
              >
                {loadingMore && (
                  <CircleNotch size={12} className="anim-spin" />
                )}
                {loadingMore ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
