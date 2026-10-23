'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CircleNotch,
  FileArrowUp,
  FileText,
  Lightning,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  CATEGORIES,
  EFFORT_LEVELS,
  UploadValidationError,
  challengerDisabled,
  decodeUtf8,
  describeSchedule,
  matchModelFromFrontMatter,
  parseMarkdownUpload,
  summariseMarkdown,
  toggleChallenger,
  validateFileSize,
  type ParsedUpload,
  type SelectableModel,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonPreview } from './comparison-preview';
import { cn } from '@/lib/utils';

export type FormModel = SelectableModel & {
  monogram: string;
};

type LoadedFile = {
  file: File;
  parsed: ParsedUpload;
  sizeLabel: string;
};

const SAMPLE_FILE_NAME = 'ratelimiter.md';
const SAMPLE_TITLE = 'Rate limiter in Go with sliding windows';
const SAMPLE_TEXT = `---
prompt: Write a thread-safe sliding-window rate limiter in Go. Allow N requests per window per key, and explain the trade-offs.
model: llama-3-3-70b
---

Here's a sliding-window rate limiter that tracks request timestamps per key. It's safe for concurrent use: every key has its own mutex, and the window is trimmed on every request.

\`\`\`go
type window struct {
    mu    sync.Mutex
    stamps []time.Time
}

func (w *window) allow(now time.Time, limit int, span time.Duration) bool {
    w.mu.Lock()
    defer w.mu.Unlock()
    cutoff := now.Add(-span)
    for len(w.stamps) > 0 && w.stamps[0].Before(cutoff) {
        w.stamps = w.stamps[1:]
    }
    if len(w.stamps) >= limit {
        return false
    }
    w.stamps = append(w.stamps, now)
    return true
}
\`\`\`

The trade-off is memory: a sliding-window log is exact, but it stores one timestamp per accepted request. A ring buffer or a coarse fixed window uses less memory at the cost of bursts at the boundary.`;

function Step({
  number,
  label,
  done,
  active,
}: {
  number: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'grid h-5 w-5 place-items-center rounded-[2px] border text-[10px] font-medium',
          done || active
            ? 'border-accent text-accent-200'
            : 'border-neutral-600 text-neutral-400',
        )}
      >
        {done ? <Check size={11} weight="bold" /> : number}
      </span>
      <span className="font-heading text-[13px] font-medium">{label}</span>
    </div>
  );
}

function sizeLabel(bytes: number, text: string) {
  const lines = text.split('\n').length;
  return `${(bytes / 1024).toFixed(1)} KB · ${lines} lines`;
}

export function NewComparisonClient({
  models,
  handle,
  maxChallengers,
}: {
  models: FormModel[];
  handle: string;
  maxChallengers: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [baseModelId, setBaseModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [effort, setEffort] = useState(2);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const schedule = describeSchedule({
    hasFile: Boolean(loaded),
    baseModelId: baseModelId || null,
    challengerIds: picked,
    prompt,
    models,
  });
  const baseModel = models.find((model) => model.id === baseModelId) ?? null;
  const pickedModels = picked
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is FormModel => Boolean(model));

  async function loadFile(
    nextFile: File,
    overrides?: { title?: string; categories?: string[] },
  ) {
    setFileError(null);
    try {
      validateFileSize(nextFile.size);
      const text = decodeUtf8(new Uint8Array(await nextFile.arrayBuffer()));
      const parsed = parseMarkdownUpload(text, nextFile.name);
      const matched = matchModelFromFrontMatter(parsed.model, models);

      setLoaded({
        file: nextFile,
        parsed,
        sizeLabel: sizeLabel(nextFile.size, text),
      });
      setPrompt(parsed.prompt ?? '');
      setTitle(overrides?.title ?? parsed.titleFromFile);
      if (overrides?.categories) setCategories(overrides.categories);

      if (matched) {
        setBaseModelId(matched.id);
        setPicked((current) => current.filter((id) => id !== matched.id));
        setModelNotice(null);
      } else if (parsed.model) {
        setBaseModelId('');
        setModelNotice(
          `We couldn't match “${parsed.model}” to a model in the registry. Choose the model that generated this output.`,
        );
      } else {
        setModelNotice(null);
      }
    } catch (error) {
      setFileError(
        error instanceof UploadValidationError
          ? error.message
          : 'That file could not be read as text.',
      );
    }
  }

  function pickFile(file: File | undefined) {
    if (file) void loadFile(file);
  }

  function toggleCategory(category: string) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category],
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || !schedule.ready || submitting) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const body = new FormData();
      body.set('file', loaded.file);
      body.set('base_model_id', baseModelId);
      body.set('prompt', prompt);
      body.set('title', title);
      body.set('effort', String(effort));
      for (const category of categories) body.append('categories', category);
      for (const modelId of picked) body.append('model_ids', modelId);

      const response = await fetch('/api/comparisons', { method: 'POST', body });
      const payload = (await response.json().catch(() => null)) as
        | { id?: string; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.id) {
        throw new Error(
          payload?.error?.message ?? 'Could not schedule this comparison. Try again.',
        );
      }

      router.push(`/comparisons/${payload.id}/job`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Could not schedule this comparison. Try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={handle} variant="page" showNew={false} />

      <main className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-8 px-5 pb-14 pt-[22px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-[26px]">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-heading text-[18px] font-medium leading-[1.2] tracking-[-0.015em]">
              New comparison
            </h1>
            <span className="text-[12px] font-normal text-neutral-400">
              Upload an output, pick who to compare it against. We&apos;ll run the same
              prompt through each model&apos;s hosted API.
            </span>
          </div>

          <section className="flex flex-col gap-[10px]">
            <Step
              number={1}
              label="Base output"
              done={Boolean(loaded && baseModelId)}
              active={!loaded || !baseModelId}
            />

            <input
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.txt"
              aria-label="Base output file"
              className="sr-only"
              onChange={(event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />

            {!loaded ? (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    pickFile(event.dataTransfer.files[0]);
                  }}
                  className={cn(
                    'flex flex-col items-start gap-[6px] rounded-[2px] border border-dashed bg-transparent p-5 text-left transition-colors focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2',
                    dragging
                      ? 'border-accent bg-accent-900'
                      : 'border-neutral-600 hover:border-accent-700',
                  )}
                >
                  <FileArrowUp size={22} className="text-accent-300" />
                  <span className="text-[12px] font-medium">
                    Drop a .md file, or{' '}
                    <span className="text-accent-300">browse</span>
                  </span>
                  <span className="text-[12px] font-normal text-neutral-500">
                    Front-matter <code className="font-mono">prompt:</code> is read
                    automatically
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const sample = new File([SAMPLE_TEXT], SAMPLE_FILE_NAME, {
                      type: 'text/markdown',
                    });
                    void loadFile(sample, {
                      title: SAMPLE_TITLE,
                      categories: ['Coding'],
                    });
                  }}
                  className="self-start text-[12px] font-medium text-neutral-400 transition-colors hover:text-accent-200"
                >
                  Use a sample file
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-[10px] rounded-[2px] bg-surface p-3">
                <div className="flex items-center gap-[10px]">
                  <FileText size={20} className="flex-none text-accent-300" />
                  <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate text-[12px] font-medium">
                      {loaded.parsed.fileName}
                    </span>
                    <span className="text-[11px] font-normal text-neutral-500">
                      {loaded.sizeLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="btn-ghost h-[26px] px-2 text-[12px]"
                  >
                    Replace
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <label className="flex flex-col gap-[5px]">
                    <span className="text-[11px] font-medium text-neutral-400">
                      Generated by
                    </span>
                    <select
                      value={baseModelId}
                      onChange={(event) => {
                        const next = event.target.value;
                        setBaseModelId(next);
                        setModelNotice(null);
                        setPicked((current) => current.filter((id) => id !== next));
                      }}
                      className={cn(
                        'h-8 rounded-[2px] border bg-bg px-2 text-[12px] font-medium text-text',
                        baseModelId ? 'border-neutral-700' : 'border-accent',
                      )}
                    >
                      <option value="">Select model…</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-[5px]">
                    <span className="text-[11px] font-medium text-neutral-400">
                      Prompt{loaded.parsed.prompt ? ' · from front-matter' : ''}
                    </span>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={2}
                      maxLength={10_000}
                      className="resize-y rounded-[2px] border border-neutral-700 bg-bg px-2 py-[7px] text-[12px] font-normal leading-[1.45] text-text focus:border-accent"
                    />
                  </label>
                </div>

                {modelNotice && (
                  <p
                    role="status"
                    className="flex items-start gap-[6px] text-[11px] font-normal leading-[1.45] text-neutral-300"
                  >
                    <WarningCircle size={13} className="mt-px flex-none text-accent-300" />
                    {modelNotice}
                  </p>
                )}
              </div>
            )}

            {fileError && (
              <p
                role="alert"
                className="flex items-start gap-[6px] text-[11px] font-normal leading-[1.45] text-danger"
              >
                <WarningCircle size={13} className="mt-px flex-none" />
                {fileError}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-2">
              <Step
                number={2}
                label="Compare against"
                done={picked.length > 0}
                active={Boolean(loaded && baseModelId) && picked.length === 0}
              />
              <div className="flex-1" />
              <span className="text-[12px] font-normal text-neutral-500">
                {picked.length} of {maxChallengers} selected
              </span>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-[6px]">
              {models.map((model) => {
                const selected = picked.includes(model.id);
                const isBase = model.id === baseModelId;
                const disabled = challengerDisabled(
                  model.id,
                  baseModelId || null,
                  picked,
                  maxChallengers,
                );

                return (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() =>
                      setPicked((current) =>
                        toggleChallenger(
                          model.id,
                          baseModelId || null,
                          current,
                          maxChallengers,
                        ),
                      )
                    }
                    className={cn(
                      'flex items-center gap-[9px] rounded-[2px] border p-[9px] text-left text-text transition-colors',
                      selected
                        ? 'border-accent bg-accent-900'
                        : 'border-neutral-800 bg-surface',
                      disabled
                        ? 'cursor-not-allowed opacity-45'
                        : 'cursor-pointer hover:border-accent-700',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-6 w-6 flex-none place-items-center rounded-[2px] text-[10px] font-semibold text-neutral-100',
                        selected ? 'bg-accent-800' : 'bg-neutral-700',
                      )}
                    >
                      {model.monogram}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <span className="truncate text-[12.5px] font-medium">
                        {model.displayName}
                      </span>
                      <span className="text-[11px] font-normal text-neutral-500">
                        {isBase ? 'Base model' : `Hosted · ~${model.etaSeconds}s`}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'grid h-4 w-4 flex-none place-items-center rounded-[2px] border',
                        selected ? 'border-accent bg-accent' : 'border-neutral-600',
                      )}
                    >
                      {selected && <Check size={11} weight="bold" className="text-bg" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <Step
              number={3}
              label="Details"
              done={Boolean(title && categories.length)}
              active={picked.length > 0}
            />

            <label className="flex flex-col gap-[5px]">
              <span className="text-[11px] font-medium text-neutral-400">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What's being compared?"
                maxLength={200}
                className="h-[34px] rounded-[2px] border border-neutral-700 bg-surface px-[10px] text-[12px] font-medium text-text focus:border-accent"
              />
            </label>

            <div className="flex flex-col gap-[6px]">
              <span className="text-[11px] font-medium text-neutral-400">Categories</span>
              <div className="flex flex-wrap gap-[5px]">
                {CATEGORIES.map((category) => {
                  const selected = categories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleCategory(category)}
                      className={cn(
                        'h-[26px] rounded-[2px] border px-[10px] text-[12px] font-medium transition-colors',
                        selected
                          ? 'border-accent bg-accent-900 text-accent-200'
                          : 'border-neutral-700 bg-transparent text-neutral-300 hover:border-accent-700',
                      )}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-[6px]">
              <span className="text-[11px] font-medium text-neutral-400">Effort level</span>
              <div className="flex gap-[2px] self-start rounded-[2px] bg-surface p-[2px]">
                {EFFORT_LEVELS.map((level) => {
                  const selected = effort === level.value;
                  return (
                    <button
                      key={level.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setEffort(level.value)}
                      className={cn(
                        'flex flex-col items-start gap-px rounded-[2px] px-3 py-[6px] text-left transition-colors',
                        selected
                          ? 'bg-neutral-700 text-text'
                          : 'bg-transparent text-neutral-400 hover:text-neutral-200',
                      )}
                    >
                      <span className="text-[12px] font-medium">{level.label}</span>
                      <span className="text-[10px] font-normal text-neutral-300">
                        {level.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {submitError && (
            <p
              role="alert"
              className="flex items-start gap-[6px] rounded-[2px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] font-normal leading-[1.45] text-danger"
            >
              <X size={14} className="mt-px flex-none" />
              {submitError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-[6px]">
            <button
              type="submit"
              disabled={!schedule.ready || submitting}
              className="flex h-9 items-center gap-[6px] rounded-[2px] border border-accent bg-accent px-4 text-[12px] font-semibold text-bg transition-colors hover:bg-accent-300 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? (
                <CircleNotch size={14} className="anim-spin" />
              ) : (
                <Lightning size={14} />
              )}
              {submitting ? 'Scheduling…' : 'Schedule comparison'}
            </button>
            <span className="text-[12px] font-normal text-neutral-500">
              {submitting ? 'Creating the job and queueing its runs…' : schedule.hint}
            </span>
          </div>
        </form>

        <ComparisonPreview
          base={
            baseModel
              ? { name: baseModel.displayName, monogram: baseModel.monogram }
              : null
          }
          challengers={pickedModels.map((model) => ({
            name: model.displayName,
            monogram: model.monogram,
          }))}
          title={title}
          categories={categories}
          effort={effort}
          baseSnippet={
            loaded ? summariseMarkdown(loaded.parsed.body, 180) : undefined
          }
          status={{ label: 'Draft', tone: 'draft' }}
          handle={handle}
          note="Live preview of the card other people will see."
        />
      </main>
    </div>
  );
}
