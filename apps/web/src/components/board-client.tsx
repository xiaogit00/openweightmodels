'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  CaretDown,
  CaretUp,
  ChatCircle,
  Check,
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

const SORT_OPTIONS = [
  { value: 'live', label: 'Live', Icon: Lightning },
  { value: 'top', label: 'Top', Icon: Flame },
  { value: 'new', label: 'New', Icon: Clock },
] as const;

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
  // The sidebar hides models with no comparisons by default. A selected model
  // always stays visible, even when its count drops to zero.
  const [showAllModels, setShowAllModels] = useState(false);
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

  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  const query = filters.q.trim();
  if (query) {
    chips.push({
      key: 'q',
      label: `“${query}”`,
      remove: () => patchFilters({ q: '' }),
    });
  }
  if (filters.cat !== 'All') {
    chips.push({
      key: `cat:${filters.cat}`,
      label: filters.cat,
      remove: () => patchFilters({ cat: 'All' }),
    });
  }
  for (const model of filters.models) {
    const name = models.find((item) => item.slug === model)?.displayName ?? model;
    chips.push({
      key: `model:${model}`,
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
      key: `effort:${filters.effort}`,
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

  const loadingFirst = phase === 'first';
  const loadingMore = phase === 'more';

  const tickerEvents = events.filter((event) => event.summary);
  // The ticker needs a duplicated list to loop seamlessly. Reduced motion
  // renders one static pass so the reader does not get a repeated sentence.
  const ticker = tickerEvents.length
    ? reducedMotion
      ? tickerEvents
      : [...tickerEvents, ...tickerEvents]
    : [];

  const filtered =
    filters.cat !== 'All' ||
    filters.models.length > 0 ||
    filters.effort !== null ||
    query.length > 0;
  const countLabel = filtered
    ? `${total} of ${facets.total} comparisons`
    : `${total} comparison${total === 1 ? '' : 's'}`;

  // The model list defaults to models that appear on at least one Comparison.
  // A selected model stays visible even if its count falls to zero.
  const modelsWithComparisons = models.filter(
    (model) => (facets.models[model.slug] ?? 0) > 0 || filters.models.includes(model.slug),
  );
  const visibleModels = showAllModels ? models : modelsWithComparisons;
  const canToggleModels = showAllModels || modelsWithComparisons.length < models.length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        signedIn={signedIn}
        search={
          <label className="flex h-8 min-w-[120px] max-w-[440px] flex-[1_1_120px] items-center gap-[10px] rounded-[var(--r)] border border-neutral-800 bg-surface pl-3 pr-[10px] focus-within:border-neutral-700">
            <MagnifyingGlass size={15} className="flex-none text-neutral-400" aria-hidden />
            <input
              ref={searchRef}
              value={filters.q}
              onChange={(event) => patchFilters({ q: event.target.value })}
              placeholder="Search prompts or models"
              aria-label="Search comparisons"
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text"
            />
            <span className="hidden flex-none rounded-[var(--r)] border border-neutral-700 px-[6px] font-mono text-[11px] leading-[18px] text-neutral-300 sm:block">
              /
            </span>
          </label>
        }
      />

      <div className="flex h-[38px] flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-b border-neutral-800 px-6 text-[12px] text-neutral-300">
        <span className="flex flex-none items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-accent-300">
          <span
            className={cn(
              'h-[6px] w-[6px] rounded-full',
              live ? 'bg-accent' : 'bg-neutral-500',
              live && !reducedMotion && 'anim-pulse',
            )}
            aria-hidden
          />
          {live ? 'LIVE' : 'RECONNECTING'}
        </span>
        <div
          className="min-w-0 flex-1 overflow-hidden"
          style={{
            maskImage:
              'linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 48px), transparent)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 48px), transparent)',
          }}
        >
          <div
            className={cn('flex w-max gap-9', !reducedMotion && 'anim-tick')}
            data-ticker
          >
            {ticker.map((event, index) => {
              const Icon = EVENT_ICONS[event.kind] ?? ChatCircle;
              const duplicate = !reducedMotion && index >= tickerEvents.length;
              return (
                <span
                  key={`${event.id}-${index}`}
                  aria-hidden={duplicate ? true : undefined}
                  className="flex flex-none items-center gap-2 text-[12px] text-neutral-300"
                >
                  <Icon size={13} className="flex-none text-neutral-400" aria-hidden />
                  {event.summary}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 lg:grid-cols-[clamp(200px,22vw,248px)_minmax(0,1fr)]">
        <aside
          aria-label="Board filters"
          className="flex flex-col gap-4 border-b border-neutral-800 px-5 py-4 [scrollbar-color:var(--color-neutral-700)_transparent] [scrollbar-width:thin] lg:sticky lg:top-[91px] lg:max-h-[calc(100vh-91px)] lg:gap-8 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:px-4 lg:pb-10 lg:pl-6 lg:pt-9"
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-[2px] lg:flex lg:flex-col">
            <MicroLabel className="col-span-2 px-[10px] pb-2 lg:col-span-1">
              CATEGORIES
            </MicroLabel>
            {['All', ...CATEGORIES].map((category) => {
              const active = filters.cat === category;
              const count =
                category === 'All' ? facets.total : (facets.categories[category] ?? 0);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patchFilters({ cat: category })}
                  className={cn(
                    'flex h-[34px] min-w-0 items-center justify-between gap-2 rounded-[var(--r)] px-[10px] text-left text-[13.5px] transition-colors',
                    active
                      ? 'bg-neutral-800 text-text'
                      : 'text-neutral-300 hover:bg-surface hover:text-text',
                  )}
                >
                  <span className="min-w-0 truncate">{category}</span>
                  <span
                    className={cn(
                      'flex-none text-[12px]',
                      active ? 'text-accent-300' : 'text-neutral-400',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-[2px] lg:flex lg:flex-col">
            <div className="col-span-2 flex items-center justify-between px-[10px] pb-2 lg:col-span-1">
              <MicroLabel>MODELS</MicroLabel>
              {filters.models.length > 0 && (
                <button
                  type="button"
                  onClick={() => patchFilters({ models: [] })}
                  className="text-[12px] text-neutral-300 transition-colors hover:text-text"
                >
                  Clear
                </button>
              )}
            </div>
            {visibleModels.map((model) => {
              const checked = filters.models.includes(model.slug);
              const count = facets.models[model.slug] ?? 0;
              return (
                <button
                  key={model.slug}
                  type="button"
                  data-model-option
                  aria-pressed={checked}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      models: checked
                        ? current.models.filter((value) => value !== model.slug)
                        : [...current.models, model.slug],
                    }))
                  }
                  className={cn(
                    'flex min-h-8 min-w-0 items-center gap-[10px] rounded-[var(--r)] px-[10px] py-1 text-left text-[13.5px] transition-colors hover:bg-surface hover:text-text',
                    checked
                      ? 'text-text'
                      : count > 0
                        ? 'text-neutral-300'
                        : 'text-neutral-500',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-[15px] w-[15px] flex-none place-items-center rounded-[var(--r)] border',
                      checked
                        ? 'border-accent bg-accent text-on-accent'
                        : 'border-neutral-600 bg-transparent',
                    )}
                  >
                    {checked && <Check size={11} weight="bold" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                  <span className="flex-none text-[12px] text-neutral-400">{count}</span>
                </button>
              );
            })}
            {canToggleModels && (
              <button
                type="button"
                data-model-toggle
                onClick={() => setShowAllModels((value) => !value)}
                className="col-span-2 mt-1 flex h-8 items-center gap-2 rounded-[var(--r)] px-[10px] text-[13px] text-neutral-300 transition-colors hover:bg-surface hover:text-text lg:col-span-1"
              >
                {showAllModels ? (
                  <CaretUp size={13} aria-hidden />
                ) : (
                  <CaretDown size={13} aria-hidden />
                )}
                {showAllModels ? 'Show fewer' : `Show all ${models.length} models`}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-[10px]">
            <MicroLabel className="px-[10px]">EFFORT</MicroLabel>
            <div className="grid grid-cols-3 gap-[6px] px-[10px]">
              {EFFORT_LEVELS.map((level) => {
                const active = filters.effort === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      patchFilters({ effort: active ? null : level.value })
                    }
                    className={cn(
                      'flex h-8 items-center justify-center rounded-[var(--r)] border text-[13px] transition-colors hover:border-accent-700',
                      active
                        ? 'border-accent-600 bg-accent-900 text-accent-200'
                        : 'border-neutral-700 text-neutral-300',
                    )}
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main
          className="flex min-w-0 flex-col gap-4 px-5 pb-12 pt-5 lg:gap-6 lg:px-8 lg:pb-[72px] lg:pt-9"
          aria-busy={loadingFirst}
        >
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex flex-col gap-[6px]">
              <h1 className="font-heading text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">
                Board
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span aria-live="polite" className="text-[13px] text-neutral-300">
                  {countLabel}
                </span>
                {loadingFirst && (
                  <span className="flex items-center gap-[5px] text-[12px] text-neutral-400">
                    <CircleNotch size={11} className="anim-spin" aria-hidden />
                    Loading…
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {pending.length > 0 && (
                <button
                  type="button"
                  onClick={flush}
                  className="flex h-[26px] items-center gap-[5px] rounded-[var(--r)] border border-accent-700 bg-accent-900 px-2.5 text-[12px] font-medium text-accent-200"
                >
                  <ArrowUp size={11} aria-hidden />
                  {pending.length} new comparison{pending.length > 1 ? 's' : ''}
                </button>
              )}
              <SegmentedControl<Sort>
                label="Sort"
                value={filters.sort}
                options={SORT_OPTIONS.map((meta) => ({
                  value: meta.value,
                  label: meta.label,
                  icon: <meta.Icon size={14} aria-hidden />,
                }))}
                itemClassName="h-[30px] gap-[7px] px-[14px] text-[13px]"
                onChange={(value) => {
                  if (value !== filters.sort) {
                    patchFilters({ sort: value });
                  } else if (pending.length > 0) {
                    flush();
                  } else {
                    // Re-clicking the active sort refetches page one, which is
                    // how a Top view applies the counts updated in place.
                    void loadFirstPage(filters);
                  }
                }}
              />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.remove}
                  className="flex h-[26px] items-center gap-[6px] rounded-[var(--r)] border border-neutral-700 pl-[10px] pr-2 text-[12.5px] text-neutral-200 transition-colors hover:border-accent-700 hover:bg-accent-900"
                >
                  {chip.label}
                  <X size={11} className="text-neutral-400" aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="h-[26px] px-[6px] text-[12.5px] text-neutral-300 transition-colors hover:text-text"
              >
                Clear all
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] border border-neutral-700 bg-surface px-4 py-3 text-[13px] text-neutral-200"
            >
              <span>{error.message}</span>
              <button
                type="button"
                onClick={retry}
                className="font-medium text-accent-300 transition-colors hover:text-accent-200"
              >
                Retry
              </button>
            </div>
          )}

          {items.length > 0 ? (
            <div
              className={cn(
                'grid items-stretch gap-4 transition-opacity',
                loadingFirst && 'opacity-50',
              )}
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
              }}
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
              className="flex items-center gap-2 py-12 text-[13px] text-neutral-400"
            >
              <CircleNotch size={13} className="anim-spin" aria-hidden />
              Loading comparisons…
            </div>
          ) : error ? null : (
            <div className="flex flex-col items-center gap-3 rounded-[var(--r-lg)] border border-dashed border-neutral-700 px-6 py-[72px] text-center">
              <span className="font-heading text-[20px] font-medium">
                No comparisons match
              </span>
              <span className="text-[13.5px] text-neutral-300">
                Try a different search or loosen the filters.
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="btn-secondary mt-1"
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
                {loadingMore && <CircleNotch size={12} className="anim-spin" aria-hidden />}
                {loadingMore ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
