import { uuidv7 } from 'uuidv7';
import { getDb, getSql } from './db/client';
import { runAsScript } from './db/run-script';
import { loadEnv } from './load-env';
import {
  activityEvents,
  annotationMessages,
  annotations,
  comments,
  comparisons,
  models,
  responses,
  users,
  votes,
} from './db/schema';
import { estimateTokens } from './domain/upload';

loadEnv();

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000);

const MODELS = [
  ['llama-3-3-70b', 'Llama 3.3 70B', 'L3', 'openrouter', 'meta-llama/llama-3.3-70b-instruct', 8],
  ['qwen-2-5-72b', 'Qwen2.5 72B', 'Q2', 'openrouter', 'qwen/qwen-2.5-72b-instruct', 6],
  ['deepseek-v3', 'DeepSeek V3', 'DS', 'openrouter', 'deepseek/deepseek-chat', 9],
  ['mistral-large', 'Mistral Large', 'MI', 'openrouter', 'mistralai/mistral-large', 5],
  ['gemma-2-27b', 'Gemma 2 27B', 'G2', 'openrouter', 'google/gemma-2-27b-it', 7],
  ['phi-4', 'Phi-4', 'P4', 'openrouter', 'microsoft/phi-4', 4],
  ['codestral', 'Codestral', 'CS', 'openrouter', 'mistralai/codestral-2501', 5],
  ['qwen-2-5-coder', 'Qwen2.5 Coder', 'QC', 'openrouter', 'qwen/qwen-2.5-coder-32b-instruct', 6],
] as const;

const USERS = [
  ['mira', 'mira@openweightmodels.test', 'Mira'],
  ['kev', 'kev@openweightmodels.test', 'Kev'],
  ['ana', 'ana@openweightmodels.test', 'Ana'],
] as const;

type SeedRow = {
  title: string;
  cat: string;
  models: string[];
  s0: string;
  s1: string;
  effort: number;
  comments: number;
  notes: number;
  author: string;
  minutesAgo: number;
};

const SEED: SeedRow[] = [
  {
    title: 'Rate limiter in Go with sliding windows',
    cat: 'Coding',
    models: ['llama-3-3-70b', 'qwen-2-5-72b', 'deepseek-v3', 'mistral-large'],
    s0: 'Here is a sliding-window rate limiter that tracks request timestamps per key. It is safe for concurrent use and evicts old entries lazily on each call.',
    s1: 'A sliding-window log is exact but stores every timestamp. A ring buffer of size limit gives O(1) checks and bounded memory.',
    effort: 2,
    comments: 3,
    notes: 4,
    author: 'mira',
    minutesAgo: 2,
  },
  {
    title: 'Explain the Monty Hall problem to a 10-year-old',
    cat: 'Reasoning',
    models: ['mistral-large', 'deepseek-v3'],
    s0: 'Imagine three doors. Behind one is a bike, behind two are goats. You pick door one, then the host opens a different door with a goat.',
    s1: 'Think of it like this: when you first pick, you have a 1 in 3 chance. The host is not choosing at random — he knows where the bike is.',
    effort: 1,
    comments: 3,
    notes: 1,
    author: 'kev',
    minutesAgo: 9,
  },
  {
    title: '300-word story: a lighthouse keeper who can’t sleep',
    cat: 'Creative',
    models: ['gemma-2-27b', 'phi-4', 'llama-3-3-70b'],
    s0: 'The lamp turned every eleven seconds, and Ada counted each one. Sleep had become a rumour she told herself at dawn.',
    s1: 'Night forty-two. The sea had stopped asking questions. It only breathed against the rocks and waited for her to answer.',
    effort: 1,
    comments: 27,
    notes: 9,
    author: 'ana',
    minutesAgo: 48,
  },
  {
    title: 'Refactor a React class component to hooks',
    cat: 'Coding',
    models: ['qwen-2-5-coder', 'codestral'],
    s0: 'Replace componentDidMount with useEffect(() => {…}, []) and move the fetch into a small helper so the effect body stays readable.',
    s1: 'function Profile({ id }) { const [user, setUser] = useState(null); useEffect(() => { let live = true; … }, [id]); }',
    effort: 2,
    comments: 8,
    notes: 2,
    author: 'kev',
    minutesAgo: 61,
  },
  {
    title: 'Prove √2 is irrational, then explain the proof',
    cat: 'Math',
    models: ['deepseek-v3', 'llama-3-3-70b', 'qwen-2-5-72b'],
    s0: 'Assume √2 = p/q in lowest terms. Then 2q² = p², so p is even. Write p = 2k and substitute to show q is even too — a contradiction.',
    s1: 'Suppose for contradiction that √2 is rational. Write it as a/b with no common factors. Squaring gives 2b² = a².',
    effort: 3,
    comments: 5,
    notes: 4,
    author: 'mira',
    minutesAgo: 95,
  },
  {
    title: 'Summarize a 40-page RFC into 5 decisions',
    cat: 'Long-context',
    models: ['phi-4', 'gemma-2-27b'],
    s0: '1. Adopt QUIC as the default transport for internal services. 2. Keep mTLS at the mesh edge. 3. Retries are capped at two.',
    s1: 'The RFC lands on five calls: transport, auth, retries, quotas, and the migration window. Only the retry budget is hard to reverse.',
    effort: 2,
    comments: 2,
    notes: 0,
    author: 'ana',
    minutesAgo: 130,
  },
  {
    title: 'SQL for monthly cohort retention',
    cat: 'Coding',
    models: ['mistral-large', 'qwen-2-5-72b', 'deepseek-v3', 'codestral'],
    s0: 'WITH cohorts AS (SELECT user_id, date_trunc(‘month’, created_at) AS cohort FROM users) SELECT cohort, month_offset, count(*) …',
    s1: 'First bucket users by signup month, then join activity by month offset. The left join keeps zero-activity months visible.',
    effort: 3,
    comments: 11,
    notes: 5,
    author: 'kev',
    minutesAgo: 170,
  },
  {
    title: 'A haiku sequence about tides',
    cat: 'Creative',
    models: ['llama-3-3-70b', 'mistral-large'],
    s0: 'moon pulls the blanket / the shore forgets its edges / gulls rewrite the line',
    s1: 'low water, low light / a crab inventories stones / the sea, returning',
    effort: 1,
    comments: 6,
    notes: 3,
    author: 'mira',
    minutesAgo: 200,
  },
  {
    title: 'Plan a 3-day Kyoto itinerary on a budget',
    cat: 'Reasoning',
    models: ['qwen-2-5-72b', 'deepseek-v3', 'phi-4'],
    s0: 'Day 1 — East: Fushimi Inari at 7am before the crowds, then Philosopher’s Path and a ¥900 lunch near Demachiyanagi.',
    s1: 'Base yourself near Kyoto Station. Get the bus day pass (¥700) and group sights by ward; temples close around 17:00.',
    effort: 2,
    comments: 4,
    notes: 1,
    author: 'ana',
    minutesAgo: 260,
  },
  {
    title: 'Regex to validate IPv6 (with explanation)',
    cat: 'Coding',
    models: ['codestral', 'llama-3-3-70b'],
    s0: '^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|…)$ — covers compressed forms, but readability suffers.',
    s1: 'Honest answer: don’t. Use a parser. But if you must, here’s a pattern that handles compressed groups and embedded IPv4.',
    effort: 1,
    comments: 9,
    notes: 6,
    author: 'kev',
    minutesAgo: 320,
  },
  {
    title: 'Logic grid puzzle: five houses, five pets',
    cat: 'Reasoning',
    models: ['deepseek-v3', 'phi-4'],
    s0: 'From clue 3, the green house is immediately left of the white. Clue 9 fixes the Norwegian in house 1. Build the grid by elimination.',
    s1: 'Let’s build the grid. Positions 1–5. Clue 9 fixes Norwegian at 1; clue 14 puts the blue house next to it.',
    effort: 3,
    comments: 13,
    notes: 8,
    author: 'mira',
    minutesAgo: 380,
  },
  {
    title: 'Translate a legal clause EN → DE, keep register',
    cat: 'Language',
    models: ['gemma-2-27b', 'mistral-large', 'qwen-2-5-72b'],
    s0: 'Die Haftung des Auftragnehmers ist auf Vorsatz und grobe Fahrlässigkeit beschränkt. Weitergehende Ansprüche sind ausgeschlossen.',
    s1: 'Der Auftragnehmer haftet nur für Vorsatz und grobe Fahrlässigkeit. Ansprüche aus Garantie bleiben unberührt.',
    effort: 2,
    comments: 1,
    notes: 0,
    author: 'ana',
    minutesAgo: 440,
  },
  {
    title: 'Write a bash one-liner to find the 10 largest files',
    cat: 'Coding',
    models: ['phi-4', 'codestral', 'llama-3-3-70b'],
    s0: 'du -ah . | sort -rh | head -n 10',
    s1: 'find . -type f -printf \'%s %p\\n\' | sort -nr | head -10',
    effort: 1,
    comments: 7,
    notes: 2,
    author: 'kev',
    minutesAgo: 500,
  },
  {
    title: 'Integrate x·e^x dx step by step',
    cat: 'Math',
    models: ['qwen-2-5-72b', 'gemma-2-27b'],
    s0: 'Use integration by parts: u = x, dv = e^x dx, so du = dx, v = e^x. The integral becomes x·e^x − ∫e^x dx.',
    s1: 'Let’s apply ∫u dv = uv − ∫v du with u = x and dv = e^x dx. The boundary term is the part people forget.',
    effort: 1,
    comments: 2,
    notes: 1,
    author: 'mira',
    minutesAgo: 560,
  },
  {
    title: 'Explain transformers to a product manager',
    cat: 'Language',
    models: ['mistral-large', 'llama-3-3-70b', 'deepseek-v3'],
    s0: 'A transformer reads every word at once and decides which ones matter for each output. Attention is the routing layer.',
    s1: 'Think autocomplete, but it looks at the whole page before guessing the next word. The “attention” is just a relevance score.',
    effort: 2,
    comments: 19,
    notes: 7,
    author: 'ana',
    minutesAgo: 640,
  },
  {
    title: 'Design a schema for a recipe app',
    cat: 'Coding',
    models: ['deepseek-v3', 'qwen-2-5-coder'],
    s0: 'recipes(id, title, servings) · ingredients(id, name) · recipe_items(recipe_id, ingredient_id, quantity, unit)',
    s1: 'Start with three tables and one join; tags as a separate many-to-many. Keep units in their own table if conversions matter.',
    effort: 2,
    comments: 6,
    notes: 3,
    author: 'kev',
    minutesAgo: 720,
  },
];

const LLAMA_BASE = `Here’s a sliding-window rate limiter that tracks request timestamps per key. It’s safe for concurrent use and evicts old entries lazily on each call.

\`\`\`go
type Limiter struct {
  mu     sync.Mutex
  window time.Duration
  limit  int
  hits   map[string][]time.Time
}

func (l *Limiter) Allow(key string) bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  now, h := time.Now(), l.hits[key]
  cut := 0
  for cut < len(h) && now.Sub(h[cut]) > l.window {
    cut++
  }
  h = h[cut:]
  if len(h) >= l.limit {
    return false
  }
  l.hits[key] = append(h, now)
  return true
}
\`\`\`

Memory grows with the number of distinct keys, so pair it with a periodic sweep if keys are user-supplied.

For distributed setups, swap the map for Redis sorted sets using a ZREMRANGEBYSCORE plus ZCARD pipeline.`;

const QWEN_BASE = `A sliding-window log is exact but stores every timestamp. A ring buffer of size limit gives O(1) checks and bounded memory:

\`\`\`go
type Limiter struct {
  mu  sync.Mutex
  buf []time.Time
  i   int
  win time.Duration
}

func (l *Limiter) Allow() bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  now := time.Now()
  if now.Sub(l.buf[l.i]) < l.win {
    return false
  }
  l.buf[l.i] = now
  l.i = (l.i + 1) % len(l.buf)
  return true
}
\`\`\`

This version is per-limiter, not per-key — wrap it in a sync.Map if you need one per client.`;

const DEEPSEEK_BASE = `Two common approaches: a sliding log (exact, O(n) memory) and a sliding window counter (approximate, O(1) memory). I’ll show the counter, which weights the previous window by how much of it still overlaps:

\`\`\`go
elapsed := now.Sub(windowStart)
weight  := 1 - float64(elapsed)/float64(window)
rate    := float64(prev)*weight + float64(curr)
if rate >= float64(limit) {
  return false
}
curr++
\`\`\`

The approximation error stays small under uniform traffic, but bursts right at a boundary can briefly exceed the limit. Use the log version if you need hard guarantees.`;

const MISTRAL_BASE = `The simplest correct approach is golang.org/x/time/rate, but that’s a token bucket, not a sliding window. Here’s a minimal sliding log:

\`\`\`go
func (l *Limiter) Allow() bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  cutoff := time.Now().Add(-l.window)
  for len(l.log) > 0 && l.log[0].Before(cutoff) {
    l.log = l.log[1:]
  }
  if len(l.log) >= l.limit {
    return false
  }
  l.log = append(l.log, time.Now())
  return true
}
\`\`\`

Reslicing keeps the backing array alive; copy periodically if the limiter is long-lived.`;

/**
 * Replaces all content with the deterministic development fixture set. Callers
 * that only want a usable database (see `db/init.ts`) should seed when empty.
 */
export async function seedDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed a production database');
  }

  const sql = getSql();
  const db = getDb();

  await sql.unsafe(`truncate table
    votes, annotation_messages, annotations, comments, job_events, activity_events,
    notifications, responses, jobs, comparisons, models, users
    restart identity cascade`);

  // One transaction so a failed seed rolls back to an empty database, which
  // `db:init` recognises and retries. The body keeps flat indentation so the
  // template literals that hold sample output stay byte-identical.
  await db.transaction(async (db) => {
  const userRows = await db
    .insert(users)
    .values(
      USERS.map(([handle, email, name]) => ({
        id: uuidv7(),
        handle,
        email,
        name,
        emailVerified: true,
        role: handle === 'mira' ? ('admin' as const) : ('user' as const),
      })),
    )
    .returning();
  const userMap = new Map(userRows.map((user) => [user.handle, user]));

  const modelRows = await db
    .insert(models)
    .values(
      MODELS.map(([slug, displayName, monogram, provider, apiModelId, etaSeconds]) => ({
        id: uuidv7(),
        slug,
        displayName,
        monogram,
        provider,
        apiModelId,
        apiBase: 'https://openrouter.ai/api/v1',
        etaSeconds,
        enabled: true,
      })),
    )
    .returning();
  const modelMap = new Map(modelRows.map((model) => [model.slug, model]));

  const comparisonIds: string[] = [];

  for (const row of SEED) {
    const author = userMap.get(row.author);
    if (!author) continue;
    const [baseSlug, ...challengerSlugs] = row.models;
    const baseModel = baseSlug ? modelMap.get(baseSlug) : undefined;
    if (!baseModel) continue;

    const publishedAt = ago(row.minutesAgo);
    const isFirst = comparisonIds.length === 0;
    const baseContent = isFirst ? LLAMA_BASE : `${row.s0}\n\nThis is the uploaded base output for this prompt.`;

    const comparisonId = uuidv7();
    const annotationCount = isFirst ? 6 : row.notes;
    const commentCount = isFirst ? 4 : row.comments;

    await db.insert(comparisons).values({
      id: comparisonId,
      authorId: author.id,
      title: row.title,
      prompt: isFirst
        ? 'Write a thread-safe sliding-window rate limiter in Go. It should allow N requests per window per key, and explain the trade-offs of your approach.'
        : row.title,
      categories: [row.cat],
      effort: row.effort,
      baseModelId: baseModel.id,
      status: 'published',
      createdAt: ago(row.minutesAgo + 5),
      publishedAt,
      commentCount,
      annotationCount,
    });

    await db.insert(responses).values({
      id: uuidv7(),
      comparisonId,
      modelId: baseModel.id,
      isBase: true,
      contentMd: baseContent,
      tokens: estimateTokens(baseContent),
      latencyMs: 0,
      status: 'done',
      finishedAt: publishedAt,
      createdAt: publishedAt,
    });

    for (const [index, slug] of challengerSlugs.entries()) {
      const model = modelMap.get(slug);
      if (!model) continue;
      const content = isFirst
        ? slug === 'qwen-2-5-72b'
          ? QWEN_BASE
          : slug === 'deepseek-v3'
            ? DEEPSEEK_BASE
            : slug === 'mistral-large'
              ? MISTRAL_BASE
              : `${row.s1}\n\nThis is a generated challenger response.`
        : `${row.s1}\n\nThis is a generated challenger response.`;
      await db.insert(responses).values({
        id: uuidv7(),
        comparisonId,
        modelId: model.id,
        isBase: false,
        contentMd: content,
        tokens: estimateTokens(content),
        latencyMs: 4200 + index * 900,
        status: 'done',
        finishedAt: publishedAt,
        createdAt: publishedAt,
      });
    }

    comparisonIds.push(comparisonId);
  }

  const firstId = comparisonIds[0];
  if (firstId) {
    const responseRows = await db.select().from(responses);
    const firstResponses = responseRows.filter((response) => response.comparisonId === firstId);
    const base = firstResponses.find((response) => response.isBase);
    const qwen = firstResponses.find(
      (response) => response.modelId === modelMap.get('qwen-2-5-72b')?.id,
    );
    const deepseek = firstResponses.find(
      (response) => response.modelId === modelMap.get('deepseek-v3')?.id,
    );

    const insertAnnotation = async (args: {
      responseId: string | undefined;
      kind: 'bug' | 'good' | 'hallucination' | 'question';
      quote: string;
      author: string;
      messages: Array<{ author: string; body: string }>;
      voters: string[];
      minutesAgo: number;
    }) => {
      if (!args.responseId) return;
      const response = firstResponses.find((item) => item.id === args.responseId);
      if (!response) return;
      const start = response.contentMd.indexOf(args.quote);
      if (start < 0) return;
      const author = userMap.get(args.author);
      if (!author) return;
      const annotationId = uuidv7();
      await db.insert(annotations).values({
        id: annotationId,
        responseId: response.id,
        authorId: author.id,
        kind: args.kind,
        startOffset: start,
        endOffset: start + args.quote.length,
        quote: args.quote,
        createdAt: ago(args.minutesAgo),
      });
      for (const [index, message] of args.messages.entries()) {
        const messageAuthor = userMap.get(message.author);
        if (!messageAuthor) continue;
        await db.insert(annotationMessages).values({
          id: uuidv7(),
          annotationId,
          authorId: messageAuthor.id,
          body: message.body,
          createdAt: ago(args.minutesAgo - index),
        });
      }
      for (const voter of new Set(args.voters)) {
        const voterRow = userMap.get(voter);
        if (!voterRow || voterRow.id === author.id) continue;
        await db.insert(votes).values({
          userId: voterRow.id,
          targetType: 'annotation',
          targetId: annotationId,
          createdAt: ago(args.minutesAgo),
        });
      }
    };

    await insertAnnotation({
      responseId: base?.id,
      kind: 'bug',
      quote: 'now.Sub(h[cut]) > l.window',
      author: 'kev',
      messages: [
        { author: 'kev', body: 'Off-by-one: a hit exactly one window old is kept. Should be >= here.' },
        { author: 'ana', body: 'Confirmed — fails the boundary test at exactly 60s.' },
      ],
      voters: ['mira', 'ana', 'mira'],
      minutesAgo: 60,
    });

    await insertAnnotation({
      responseId: base?.id,
      kind: 'good',
      quote: 'pair it with a periodic sweep',
      author: 'ana',
      messages: [
        {
          author: 'ana',
          body: 'Nice that it calls out the unbounded-keys problem without being asked.',
        },
      ],
      voters: ['mira', 'kev'],
      minutesAgo: 40,
    });

    await insertAnnotation({
      responseId: qwen?.id,
      kind: 'good',
      quote: 'A ring buffer of size limit gives O(1) checks and bounded memory',
      author: 'mira',
      messages: [
        { author: 'mira', body: 'This is the cleanest answer here. Bounded memory and no edge bug.' },
      ],
      voters: ['kev', 'ana'],
      minutesAgo: 58,
    });

    await insertAnnotation({
      responseId: qwen?.id,
      kind: 'question',
      quote: 'wrap it in a sync.Map if you need one per client',
      author: 'kev',
      messages: [
        {
          author: 'kev',
          body: 'Would sync.Map actually be the right choice, or a sharded map with mutexes?',
        },
      ],
      voters: ['ana'],
      minutesAgo: 30,
    });

    await insertAnnotation({
      responseId: deepseek?.id,
      kind: 'question',
      quote: 'The approximation error stays small under uniform traffic',
      author: 'ana',
      messages: [
        { author: 'ana', body: 'How small? Would love a number or a source here.' },
      ],
      voters: ['mira', 'kev'],
      minutesAgo: 22,
    });

    await insertAnnotation({
      responseId: base?.id,
      kind: 'hallucination',
      quote: 'ZREMRANGEBYSCORE plus ZCARD pipeline',
      author: 'mira',
      messages: [
        {
          author: 'mira',
          body: 'This is real Redis, but it is not a sliding-window helper and it ignores per-key cleanup.',
        },
      ],
      voters: ['kev'],
      minutesAgo: 12,
    });

    const commentRows = await db
      .insert(comments)
      .values([
        {
          id: uuidv7(),
          comparisonId: firstId,
          authorId: userMap.get('kev')!.id,
          aboutModelId: modelMap.get('llama-3-3-70b')!.id,
          body: 'Llama has the classic edge bug — a request exactly at the window length still counts. Qwen’s ring buffer avoids it entirely.',
          createdAt: ago(55),
        },
        {
          id: uuidv7(),
          comparisonId: firstId,
          authorId: userMap.get('ana')!.id,
          aboutModelId: modelMap.get('deepseek-v3')!.id,
          body: 'Only one that explained the trade-off before writing code. That’s what I’d want in a review.',
          createdAt: ago(48),
        },
        {
          id: uuidv7(),
          comparisonId: firstId,
          authorId: userMap.get('mira')!.id,
          aboutModelId: null,
          body: 'Would be great to rerun with a stricter prompt — “per-key, bounded memory”. Effort should probably be High.',
          createdAt: ago(20),
        },
      ])
      .returning();

    const firstComment = commentRows[0];
    if (firstComment) {
      await db.insert(comments).values({
        id: uuidv7(),
        comparisonId: firstId,
        authorId: userMap.get('mira')!.id,
        parentId: firstComment.id,
        aboutModelId: firstComment.aboutModelId,
        body: 'Fair. I’ll note it as a known issue in the prompt.',
        createdAt: ago(17),
      });
    }

    const votePlan: Array<[string, string, string[]]> = [
      ['comment', commentRows[0]?.id ?? '', ['mira', 'ana']],
      ['comment', commentRows[1]?.id ?? '', ['mira', 'kev']],
      ['comment', commentRows[2]?.id ?? '', ['kev']],
    ];
    for (const [targetType, targetId, voterHandles] of votePlan) {
      if (!targetId) continue;
      for (const handle of voterHandles) {
        const voter = userMap.get(handle);
        if (!voter) continue;
        await db.insert(votes).values({
          userId: voter.id,
          targetType: targetType as 'comment',
          targetId,
          createdAt: ago(10),
        });
      }
    }
  }

  await db.insert(activityEvents).values([
    {
      kind: 'comparison.published',
      actorId: userMap.get('ana')?.id,
      comparisonId: comparisonIds[0] ?? null,
      summary: 'compared Llama 3.3 70B vs Qwen2.5 72B',
      payload: {},
      createdAt: ago(2),
    },
    {
      kind: 'annotation.created',
      actorId: userMap.get('kev')?.id,
      comparisonId: comparisonIds[0] ?? null,
      summary: 'annotated Qwen2.5 72B',
      payload: {},
      createdAt: ago(4),
    },
    {
      kind: 'comment.replied',
      actorId: userMap.get('ana')?.id,
      comparisonId: comparisonIds[1] ?? null,
      summary: 'replied on Monty Hall…',
      payload: {},
      createdAt: ago(7),
    },
    {
      kind: 'run.finished',
      actorId: userMap.get('mira')?.id,
      comparisonId: comparisonIds[6] ?? null,
      summary: 'finished SQL cohort retention',
      payload: {},
      createdAt: ago(11),
    },
  ]);

  console.log(`seeded ${comparisonIds.length} comparisons, ${userRows.length} users, ${modelRows.length} models`);
  });
}

runAsScript(import.meta.url, seedDatabase);
