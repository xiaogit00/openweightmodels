import { uuidv7 } from 'uuidv7';

export type ModelRelease = 'current' | 'previous';

export type ModelRegistryEntry = {
  slug: string;
  displayName: string;
  monogram: string;
  provider: string;
  apiModelId: string;
  apiBase: string;
  etaSeconds: number;
  /** Whether the model's weights are published for self-hosting or other providers. */
  openWeights: boolean;
  /** The model line this entry belongs to, e.g. `qwen`. */
  family: string;
  /** Which release this entry represents within its family. */
  release: ModelRelease;
};

export type ModelRegistryProblem =
  | { code: 'duplicate_slug'; slug: string }
  | { code: 'duplicate_api_model_id'; apiModelId: string }
  | { code: 'missing_monogram'; slug: string }
  | { code: 'duplicate_monogram'; monogram: string }
  | { code: 'invalid_eta'; slug: string }
  | { code: 'missing_current'; family: string }
  | { code: 'duplicate_release'; family: string; release: ModelRelease };

/**
 * The curated Model registry. Every entry was checked against OpenRouter's
 * `/api/v1/models` on 2026-10-29 (see `docs/MODEL-REGISTRY.md`). Families carry
 * their current release and the previous one while both remain callable;
 * closed frontier models sit alongside open-weight ones and are flagged with
 * `openWeights`.
 *
 * Docker Compose seeds it with the development content; production bootstraps
 * it with `pnpm db:bootstrap`, which upserts these rows and never creates users,
 * Comparisons or other fake content.
 */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  // Open-weight families
  {
    slug: 'llama-4-maverick',
    displayName: 'Llama 4 Maverick',
    monogram: 'L4',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-4-maverick',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 12,
    openWeights: true,
    family: 'llama',
    release: 'current',
  },
  {
    slug: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B',
    monogram: 'L3',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-3.3-70b-instruct',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
    openWeights: true,
    family: 'llama',
    release: 'previous',
  },
  {
    slug: 'qwen-3-8-27b',
    displayName: 'Qwen3.8 27B',
    monogram: 'Q8',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.8-27b',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
    openWeights: true,
    family: 'qwen',
    release: 'current',
  },
  {
    slug: 'qwen-3-6-27b',
    displayName: 'Qwen3.6 27B',
    monogram: 'Q6',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.6-27b',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 7,
    openWeights: true,
    family: 'qwen',
    release: 'previous',
  },
  {
    slug: 'deepseek-v4-1-flash',
    displayName: 'DeepSeek V4.1 Flash 1017',
    monogram: 'D5',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4.1-flash-1017',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
    openWeights: true,
    family: 'deepseek',
    release: 'current',
  },
  {
    slug: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash 0731',
    monogram: 'D4',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4-flash-0731',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
    openWeights: true,
    family: 'deepseek',
    release: 'previous',
  },
  {
    slug: 'mistral-large-4',
    displayName: 'Mistral Large 4',
    monogram: 'M4',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-large-4-0',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 10,
    openWeights: true,
    family: 'mistral',
    release: 'current',
  },
  {
    slug: 'mistral-large-3',
    displayName: 'Mistral Large 3',
    monogram: 'M3',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-large-2512',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 12,
    openWeights: true,
    family: 'mistral',
    release: 'previous',
  },
  {
    slug: 'gemma-4-31b',
    displayName: 'Gemma 4 31B',
    monogram: 'G4',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-31b-it',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
    openWeights: true,
    family: 'gemma',
    release: 'current',
  },
  {
    slug: 'gemma-3-27b',
    displayName: 'Gemma 3 27B',
    monogram: 'G3',
    provider: 'openrouter',
    apiModelId: 'google/gemma-3-27b-it',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 7,
    openWeights: true,
    family: 'gemma',
    release: 'previous',
  },
  {
    slug: 'phi-4',
    displayName: 'Phi 4',
    monogram: 'P4',
    provider: 'openrouter',
    apiModelId: 'microsoft/phi-4',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 4,
    openWeights: true,
    family: 'phi',
    release: 'current',
  },
  {
    slug: 'kimi-k3',
    displayName: 'Kimi K3',
    monogram: 'K3',
    provider: 'openrouter',
    apiModelId: 'moonshotai/kimi-k3',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 20,
    openWeights: true,
    family: 'kimi',
    release: 'current',
  },
  {
    slug: 'kimi-k2-6',
    displayName: 'Kimi K2.6',
    monogram: 'K2',
    provider: 'openrouter',
    apiModelId: 'moonshotai/kimi-k2.6',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 18,
    openWeights: true,
    family: 'kimi',
    release: 'previous',
  },
  {
    slug: 'glm-5-3',
    displayName: 'GLM 5.3',
    monogram: 'Z5',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-5.3',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 9,
    openWeights: true,
    family: 'glm',
    release: 'current',
  },
  {
    slug: 'glm-5-2',
    displayName: 'GLM 5.2',
    monogram: 'Z4',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-5.2',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 10,
    openWeights: true,
    family: 'glm',
    release: 'previous',
  },
  {
    slug: 'minimax-m3',
    displayName: 'MiniMax M3',
    monogram: 'X3',
    provider: 'openrouter',
    apiModelId: 'minimax/minimax-m3',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 9,
    openWeights: true,
    family: 'minimax',
    release: 'current',
  },
  {
    slug: 'minimax-m2-7',
    displayName: 'MiniMax M2.7',
    monogram: 'X2',
    provider: 'openrouter',
    apiModelId: 'minimax/minimax-m2.7',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
    openWeights: true,
    family: 'minimax',
    release: 'previous',
  },
  {
    slug: 'gpt-oss-120b',
    displayName: 'gpt-oss-120b',
    monogram: 'GO',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-oss-120b',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
    openWeights: true,
    family: 'gpt-oss',
    release: 'current',
  },
  {
    slug: 'nemotron-3-5-lightning',
    displayName: 'Nemotron 3.5 Lightning',
    monogram: 'N4',
    provider: 'openrouter',
    apiModelId: 'nvidia/nemotron-3.5-lightning',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 5,
    openWeights: true,
    family: 'nemotron',
    release: 'current',
  },
  {
    slug: 'nemotron-3-ultra',
    displayName: 'Nemotron 3 Ultra',
    monogram: 'N3',
    provider: 'openrouter',
    apiModelId: 'nvidia/nemotron-3-ultra-550b-a55b',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 16,
    openWeights: true,
    family: 'nemotron',
    release: 'previous',
  },

  // Closed frontier families
  {
    slug: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    monogram: 'C6',
    provider: 'openrouter',
    apiModelId: 'anthropic/claude-opus-5.5',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 24,
    openWeights: false,
    family: 'claude',
    release: 'current',
  },
  {
    slug: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    monogram: 'C5',
    provider: 'openrouter',
    apiModelId: 'anthropic/claude-opus-5',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 22,
    openWeights: false,
    family: 'claude',
    release: 'previous',
  },
  {
    slug: 'gpt-6-1-sol',
    displayName: 'GPT-6.1 Sol',
    monogram: 'O6',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-6.1-sol',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 20,
    openWeights: false,
    family: 'gpt',
    release: 'current',
  },
  {
    slug: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    monogram: 'O5',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-6-sol',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 18,
    openWeights: false,
    family: 'gpt',
    release: 'previous',
  },
  {
    slug: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    monogram: 'GM',
    provider: 'openrouter',
    apiModelId: 'google/gemini-4-argon',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 16,
    openWeights: false,
    family: 'gemini',
    release: 'current',
  },
  {
    slug: 'gemini-3-8-flash',
    displayName: 'Gemini 3.8 Flash',
    monogram: 'G8',
    provider: 'openrouter',
    apiModelId: 'google/gemini-3.8-flash',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 9,
    openWeights: false,
    family: 'gemini',
    release: 'previous',
  },
  {
    slug: 'grok-4-7',
    displayName: 'Grok 4.7',
    monogram: 'X7',
    provider: 'openrouter',
    apiModelId: 'x-ai/grok-4.7',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 14,
    openWeights: false,
    family: 'grok',
    release: 'current',
  },
  {
    slug: 'grok-4-6',
    displayName: 'Grok 4.6',
    monogram: 'X6',
    provider: 'openrouter',
    apiModelId: 'x-ai/grok-4.6',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 13,
    openWeights: false,
    family: 'grok',
    release: 'previous',
  },
  {
    slug: 'command-a-plus',
    displayName: 'Command A+',
    monogram: 'CA',
    provider: 'openrouter',
    apiModelId: 'cohere/command-a-plus',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
    openWeights: false,
    family: 'command',
    release: 'current',
  },
  {
    slug: 'command-a',
    displayName: 'Command A',
    monogram: 'CO',
    provider: 'openrouter',
    apiModelId: 'cohere/command-a',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 10,
    openWeights: false,
    family: 'command',
    release: 'previous',
  },
];

/**
 * Validate a catalogue before it reaches the database. Production bootstrap and
 * the registry tests both use this so a typo fails the release rather than
 * silently producing duplicate or unusable pickers.
 */
export function validateModelRegistry(
  entries: readonly ModelRegistryEntry[],
): ModelRegistryProblem[] {
  const problems: ModelRegistryProblem[] = [];

  const slugCounts = new Map<string, number>();
  const apiIdCounts = new Map<string, number>();
  const monogramCounts = new Map<string, number>();
  for (const entry of entries) {
    slugCounts.set(entry.slug, (slugCounts.get(entry.slug) ?? 0) + 1);
    apiIdCounts.set(entry.apiModelId, (apiIdCounts.get(entry.apiModelId) ?? 0) + 1);

    const monogram = entry.monogram.trim();
    if (!monogram) {
      problems.push({ code: 'missing_monogram', slug: entry.slug });
    } else {
      monogramCounts.set(monogram, (monogramCounts.get(monogram) ?? 0) + 1);
    }
    if (!Number.isInteger(entry.etaSeconds) || entry.etaSeconds <= 0) {
      problems.push({ code: 'invalid_eta', slug: entry.slug });
    }
  }

  for (const [slug, count] of slugCounts) {
    if (count > 1) problems.push({ code: 'duplicate_slug', slug });
  }
  for (const [apiModelId, count] of apiIdCounts) {
    if (count > 1) problems.push({ code: 'duplicate_api_model_id', apiModelId });
  }
  for (const [monogram, count] of monogramCounts) {
    if (count > 1) problems.push({ code: 'duplicate_monogram', monogram });
  }

  const families = new Map<string, ModelRelease[]>();
  for (const entry of entries) {
    const releases = families.get(entry.family) ?? [];
    releases.push(entry.release);
    families.set(entry.family, releases);
  }

  for (const [family, releases] of families) {
    if (!releases.includes('current')) {
      problems.push({ code: 'missing_current', family });
    }
    for (const release of ['current', 'previous'] as const) {
      if (releases.filter((value) => value === release).length > 1) {
        problems.push({ code: 'duplicate_release', family, release });
      }
    }
  }

  return problems;
}

export function assertModelRegistryValid(
  entries: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
) {
  const problems = validateModelRegistry(entries);
  if (problems.length) {
    const detail = problems
      .map((problem) => Object.entries(problem).map(([, value]) => value).join(' '))
      .join('; ');
    throw new Error(`Invalid Model registry: ${detail}`);
  }
  return entries;
}

assertModelRegistryValid();

export function modelRegistryRows() {
  return MODEL_REGISTRY.map(({ family: _family, release: _release, ...entry }) => ({
    id: uuidv7(),
    ...entry,
    enabled: true,
  }));
}
