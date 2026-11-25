import { uuidv7 } from 'uuidv7';
import type { WeightClassKey } from './domain/weight-class';

export type ModelRegistryEntry = {
  slug: string;
  displayName: string;
  monogram: string;
  /**
   * Public path to the Model's provider/family mark. Icons are stored locally
   * under `apps/web/public/model-icons` so cards never hotlink a third party.
   */
  avatarUrl: string;
  /** The lab or vendor that published the Model, shown on a card. */
  publisher: string;
  provider: string;
  apiModelId: string;
  apiBase: string;
  etaSeconds: number;
  /** Whether the model's weights are published for self-hosting or other providers. */
  openWeights: boolean;
  /** The model line this entry belongs to, e.g. `qwen`. Search metadata only. */
  family: string;
  /** Curated hardware tier; `null` on frontier Models. */
  weightClass: WeightClassKey | null;
  /** Memory to run the model at 4-bit, in GB; `null` on frontier Models. */
  runSizeGb: number | null;
  /** Display parameter count, e.g. `27B`; `null` on frontier Models. */
  totalParams: string | null;
  /** Active parameter count for a mixture of experts, when it differs. */
  activeParams: string | null;
};

export type ModelRegistryProblem =
  | { code: 'duplicate_slug'; slug: string }
  | { code: 'duplicate_api_model_id'; apiModelId: string }
  | { code: 'missing_monogram'; slug: string }
  | { code: 'missing_avatar'; slug: string }
  | { code: 'missing_publisher'; slug: string }
  | { code: 'invalid_eta'; slug: string }
  | { code: 'missing_weight_class'; slug: string }
  | { code: 'missing_run_size'; slug: string }
  | { code: 'missing_total_params'; slug: string }
  | { code: 'weight_class_on_frontier'; slug: string }
  | { code: 'run_size_on_frontier'; slug: string }
  | { code: 'params_on_frontier'; slug: string };

type EntryIdentity = Pick<
  ModelRegistryEntry,
  | 'slug'
  | 'displayName'
  | 'monogram'
  | 'publisher'
  | 'provider'
  | 'apiModelId'
  | 'apiBase'
  | 'etaSeconds'
  | 'family'
>;

const OPENROUTER = 'https://openrouter.ai/api/v1';

/**
 * The most specific local mark for each Model family. Several families share a
 * publisher mark (`llama` and `muse` use Meta, `gpt` and `gpt-oss` use OpenAI)
 * because no separate family logo is available. Files live in
 * `apps/web/public/model-icons`; the source of each is recorded in that
 * directory's README.
 */
export const MODEL_FAMILY_AVATARS: Readonly<Record<string, string>> = {
  llama: '/model-icons/meta.svg',
  muse: '/model-icons/meta.svg',
  ministral: '/model-icons/mistral.svg',
  mistral: '/model-icons/mistral.svg',
  qwen: '/model-icons/qwen.svg',
  'gpt-oss': '/model-icons/openai.svg',
  gpt: '/model-icons/openai.svg',
  phi: '/model-icons/microsoft.svg',
  gemma: '/model-icons/gemma.svg',
  nemotron: '/model-icons/nvidia.svg',
  glm: '/model-icons/zhipu.svg',
  minimax: '/model-icons/minimax.svg',
  inkling: '/model-icons/thinking-machines.svg',
  deepseek: '/model-icons/deepseek.svg',
  hy: '/model-icons/hunyuan.svg',
  mimo: '/model-icons/xiaomimimo.svg',
  kimi: '/model-icons/kimi.svg',
  claude: '/model-icons/claude.svg',
  gemini: '/model-icons/gemini.svg',
  grok: '/model-icons/grok.svg',
  command: '/model-icons/cohere.svg',
};

function avatarForFamily(family: string): string {
  const avatarUrl = MODEL_FAMILY_AVATARS[family];
  if (!avatarUrl) {
    throw new Error(`No Model icon is mapped for family "${family}"`);
  }
  return avatarUrl;
}

function openWeight(
  entry: EntryIdentity & {
    weightClass: WeightClassKey;
    runSizeGb: number;
    totalParams: string;
    activeParams?: string;
  },
): ModelRegistryEntry {
  return {
    ...entry,
    avatarUrl: avatarForFamily(entry.family),
    openWeights: true,
    activeParams: entry.activeParams ?? null,
  };
}

function frontier(entry: EntryIdentity): ModelRegistryEntry {
  return {
    ...entry,
    avatarUrl: avatarForFamily(entry.family),
    openWeights: false,
    weightClass: null,
    runSizeGb: null,
    totalParams: null,
    activeParams: null,
  };
}

/**
 * The curated Model registry. Every provider ID was checked against
 * OpenRouter's live `/api/v1/models` list. The open-weight catalogue was
 * verified on **2026-11-23**: 29 of the 42 rows in
 * `design_handoff_weight_class/models_by_weight_class_curated.csv` resolved to
 * a replayable Model, and those 20 not already here were added. The other
 * eleven open-weight Models are hand-curated entries the CSV omits. A CSV row
 * that did not resolve was not added.
 *
 * Models are peers: there is no `current`/`previous` slot. Each one stands in
 * its curated Weight class, and `family` is invisible search metadata.
 *
 * Docker Compose seeds it with the development content; production bootstraps
 * it with `pnpm db:bootstrap`, which upserts these rows and never creates users,
 * Comparisons or other fake content.
 */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  // Fly weight
  openWeight({
    slug: 'llama-3-2-3b',
    displayName: 'Llama 3.2 3B',
    monogram: 'L2',
    publisher: 'Meta',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-3.2-3b-instruct',
    apiBase: OPENROUTER,
    etaSeconds: 5,
    family: 'llama',
    weightClass: 'fly',
    runSizeGb: 5,
    totalParams: '3B',
  }),
  openWeight({
    slug: 'ministral-3b',
    displayName: 'Ministral 3B',
    monogram: 'M3',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/ministral-3b-2512',
    apiBase: OPENROUTER,
    etaSeconds: 6,
    family: 'ministral',
    weightClass: 'fly',
    runSizeGb: 6,
    totalParams: '3B',
  }),

  // Feather weight
  openWeight({
    slug: 'qwen-3-5-9b',
    displayName: 'Qwen3.5 9B',
    monogram: 'Q9',
    publisher: 'Alibaba',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.5-9b',
    apiBase: OPENROUTER,
    etaSeconds: 7,
    family: 'qwen',
    weightClass: 'feather',
    runSizeGb: 12,
    totalParams: '9B',
  }),
  openWeight({
    slug: 'ministral-8b',
    displayName: 'Ministral 8B',
    monogram: 'M8',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/ministral-8b-2512',
    apiBase: OPENROUTER,
    etaSeconds: 7,
    family: 'ministral',
    weightClass: 'feather',
    runSizeGb: 12,
    totalParams: '8B',
  }),
  openWeight({
    slug: 'ministral-14b',
    displayName: 'Ministral 14B',
    monogram: 'M1',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/ministral-14b-2512',
    apiBase: OPENROUTER,
    etaSeconds: 7,
    family: 'ministral',
    weightClass: 'feather',
    runSizeGb: 20,
    totalParams: '14B',
  }),
  openWeight({
    slug: 'gpt-oss-20b',
    displayName: 'gpt-oss-20b',
    monogram: 'G2',
    publisher: 'OpenAI',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-oss-20b',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'gpt-oss',
    weightClass: 'feather',
    runSizeGb: 24,
    totalParams: '21B',
    activeParams: '3.6B',
  }),
  openWeight({
    slug: 'phi-4',
    displayName: 'Phi 4',
    monogram: 'P4',
    publisher: 'Microsoft',
    provider: 'openrouter',
    apiModelId: 'microsoft/phi-4',
    apiBase: OPENROUTER,
    etaSeconds: 4,
    family: 'phi',
    weightClass: 'feather',
    runSizeGb: 20,
    totalParams: '14B',
  }),

  // Light weight
  openWeight({
    slug: 'qwen-3-8-27b',
    displayName: 'Qwen3.8 27B',
    monogram: 'Q8',
    publisher: 'Alibaba',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.8-27b',
    apiBase: OPENROUTER,
    etaSeconds: 6,
    family: 'qwen',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '27B',
  }),
  openWeight({
    slug: 'qwen-3-6-27b',
    displayName: 'Qwen3.6 27B',
    monogram: 'Q6',
    publisher: 'Alibaba',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.6-27b',
    apiBase: OPENROUTER,
    etaSeconds: 7,
    family: 'qwen',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '27B',
  }),
  openWeight({
    slug: 'gemma-4-31b',
    displayName: 'Gemma 4 31B',
    monogram: 'G4',
    publisher: 'Google',
    provider: 'openrouter',
    apiModelId: 'google/gemma-4-31b-it',
    apiBase: OPENROUTER,
    etaSeconds: 6,
    family: 'gemma',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '31B',
  }),
  openWeight({
    slug: 'gemma-3-27b',
    displayName: 'Gemma 3 27B',
    monogram: 'G3',
    publisher: 'Google',
    provider: 'openrouter',
    apiModelId: 'google/gemma-3-27b-it',
    apiBase: OPENROUTER,
    etaSeconds: 7,
    family: 'gemma',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '27B',
  }),
  openWeight({
    slug: 'nemotron-3-5-lightning',
    displayName: 'Nemotron 3.5 Lightning',
    monogram: 'N4',
    publisher: 'NVIDIA',
    provider: 'openrouter',
    apiModelId: 'nvidia/nemotron-3.5-lightning',
    apiBase: OPENROUTER,
    etaSeconds: 5,
    family: 'nemotron',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '30B',
    activeParams: '3B',
  }),
  openWeight({
    slug: 'glm-4-7-flash',
    displayName: 'GLM 4.7 Flash',
    monogram: 'G7',
    publisher: 'Zhipu AI',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-4.7-flash',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'glm',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '30B',
    activeParams: '3B',
  }),
  openWeight({
    slug: 'muse-glimmer-30b',
    displayName: 'Muse Glimmer 30B',
    monogram: 'MG',
    publisher: 'Meta (MSL)',
    provider: 'openrouter',
    apiModelId: 'meta/muse-glimmer-30b',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'muse',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '29.6B',
  }),

  // Middle weight
  openWeight({
    slug: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B',
    monogram: 'L3',
    publisher: 'Meta',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-3.3-70b-instruct',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'llama',
    weightClass: 'middle',
    runSizeGb: 64,
    totalParams: '70B',
  }),
  openWeight({
    slug: 'qwen3-coder-next-80b-a3b',
    displayName: 'Qwen3 Coder Next 80B-A3B',
    monogram: 'QC',
    publisher: 'Alibaba',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3-coder-next',
    apiBase: OPENROUTER,
    etaSeconds: 9,
    family: 'qwen',
    weightClass: 'middle',
    runSizeGb: 64,
    totalParams: '80B',
    activeParams: '3B',
  }),
  openWeight({
    slug: 'glm-4-5-air',
    displayName: 'GLM 4.5 Air',
    monogram: 'GA',
    publisher: 'Zhipu AI',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-4.5-air',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'glm',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '106B',
    activeParams: '12B',
  }),
  openWeight({
    slug: 'gpt-oss-120b',
    displayName: 'gpt-oss-120b',
    monogram: 'GO',
    publisher: 'OpenAI',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-oss-120b',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'gpt-oss',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '117B',
    activeParams: '5.1B',
  }),
  openWeight({
    slug: 'mistral-small-4',
    displayName: 'Mistral Small 4',
    monogram: 'MS',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-small-2603',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'mistral',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '119B',
    activeParams: '6B',
  }),
  openWeight({
    slug: 'nemotron-3-5-super-vl',
    displayName: 'Nemotron 3.5 Super-VL',
    monogram: 'NS',
    publisher: 'NVIDIA',
    provider: 'openrouter',
    apiModelId: 'nvidia/nemotron-3.5-super-vl',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'nemotron',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '120B',
    activeParams: '12B',
  }),
  openWeight({
    slug: 'qwen-3-5-122b-a10b',
    displayName: 'Qwen3.5 122B-A10B',
    monogram: 'Q1',
    publisher: 'Alibaba',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen3.5-122b-a10b',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'qwen',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '122B',
    activeParams: '10B',
  }),
  openWeight({
    slug: 'mistral-medium-3-5-128b',
    displayName: 'Mistral Medium 3.5 128B',
    monogram: 'MM',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-medium-3-5',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'mistral',
    weightClass: 'middle',
    runSizeGb: 104,
    totalParams: '128B',
  }),

  // Heavy weight
  openWeight({
    slug: 'minimax-m2-7',
    displayName: 'MiniMax M2.7',
    monogram: 'X2',
    publisher: 'MiniMax',
    provider: 'openrouter',
    apiModelId: 'minimax/minimax-m2.7',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'minimax',
    weightClass: 'heavy',
    runSizeGb: 144,
    totalParams: '230B',
    activeParams: '10B',
  }),
  openWeight({
    slug: 'glm-5-3-flash',
    displayName: 'GLM 5.3 Flash',
    monogram: 'GF',
    publisher: 'Zhipu AI',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-5.3-flash',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'glm',
    weightClass: 'heavy',
    runSizeGb: 144,
    totalParams: '320B',
    activeParams: '18B',
  }),
  openWeight({
    slug: 'inkling-small',
    displayName: 'Inkling Small',
    monogram: 'IS',
    publisher: 'Thinking Machines',
    provider: 'openrouter',
    apiModelId: 'thinkingmachines/inkling-small',
    apiBase: OPENROUTER,
    etaSeconds: 11,
    family: 'inkling',
    weightClass: 'heavy',
    runSizeGb: 200,
    totalParams: '276B',
    activeParams: '12B',
  }),
  openWeight({
    slug: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash 0731',
    monogram: 'D4',
    publisher: 'DeepSeek',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4-flash-0731',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'deepseek',
    weightClass: 'heavy',
    runSizeGb: 208,
    totalParams: '284B',
    activeParams: '13B',
  }),
  openWeight({
    slug: 'deepseek-v4-1-flash',
    displayName: 'DeepSeek V4.1 Flash 1017',
    monogram: 'D5',
    publisher: 'DeepSeek',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4.1-flash-1017',
    apiBase: OPENROUTER,
    etaSeconds: 6,
    family: 'deepseek',
    weightClass: 'heavy',
    runSizeGb: 208,
    totalParams: '284B',
    activeParams: '13B',
  }),
  openWeight({
    slug: 'hy3',
    displayName: 'Hy3',
    monogram: 'H3',
    publisher: 'Tencent',
    provider: 'openrouter',
    apiModelId: 'tencent/hy3',
    apiBase: OPENROUTER,
    etaSeconds: 11,
    family: 'hy',
    weightClass: 'heavy',
    runSizeGb: 208,
    totalParams: '295B',
    activeParams: '21B',
  }),
  openWeight({
    slug: 'mimo-v2-6-flash',
    displayName: 'MiMo-V2.6-Flash',
    monogram: 'MV',
    publisher: 'Xiaomi',
    provider: 'openrouter',
    apiModelId: 'xiaomi/mimo-v2.6-flash',
    apiBase: OPENROUTER,
    etaSeconds: 11,
    family: 'mimo',
    weightClass: 'heavy',
    runSizeGb: 216,
    totalParams: '309B',
    activeParams: '15B',
  }),
  openWeight({
    slug: 'llama-4-maverick',
    displayName: 'Llama 4 Maverick',
    monogram: 'L4',
    publisher: 'Meta',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-4-maverick',
    apiBase: OPENROUTER,
    etaSeconds: 12,
    family: 'llama',
    weightClass: 'heavy',
    runSizeGb: 232,
    totalParams: '400B',
    activeParams: '17B',
  }),
  openWeight({
    slug: 'minimax-m3',
    displayName: 'MiniMax M3',
    monogram: 'X3',
    publisher: 'MiniMax',
    provider: 'openrouter',
    apiModelId: 'minimax/minimax-m3',
    apiBase: OPENROUTER,
    etaSeconds: 9,
    family: 'minimax',
    weightClass: 'heavy',
    runSizeGb: 272,
    totalParams: '428B',
    activeParams: '23B',
  }),
  openWeight({
    slug: 'minimax-m3-1-flash',
    displayName: 'MiniMax M3.1 Flash',
    monogram: 'MX',
    publisher: 'MiniMax',
    provider: 'openrouter',
    apiModelId: 'minimax/minimax-m3.1-flash',
    apiBase: OPENROUTER,
    etaSeconds: 11,
    family: 'minimax',
    weightClass: 'heavy',
    runSizeGb: 272,
    totalParams: '428B',
    activeParams: '23B',
  }),

  // Super Heavy weight
  openWeight({
    slug: 'glm-5-3',
    displayName: 'GLM 5.3',
    monogram: 'Z5',
    publisher: 'Zhipu AI',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-5.3',
    apiBase: OPENROUTER,
    etaSeconds: 9,
    family: 'glm',
    weightClass: 'super-heavy',
    runSizeGb: 304,
    totalParams: '744B',
    activeParams: '40B',
  }),
  openWeight({
    slug: 'glm-5-2',
    displayName: 'GLM 5.2',
    monogram: 'Z4',
    publisher: 'Zhipu AI',
    provider: 'openrouter',
    apiModelId: 'z-ai/glm-5.2',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'glm',
    weightClass: 'super-heavy',
    runSizeGb: 304,
    totalParams: '744B',
    activeParams: '40B',
  }),
  openWeight({
    slug: 'nemotron-3-ultra',
    displayName: 'Nemotron 3 Ultra',
    monogram: 'N3',
    publisher: 'NVIDIA',
    provider: 'openrouter',
    apiModelId: 'nvidia/nemotron-3-ultra-550b-a55b',
    apiBase: OPENROUTER,
    etaSeconds: 16,
    family: 'nemotron',
    weightClass: 'super-heavy',
    runSizeGb: 320,
    totalParams: '550B',
    activeParams: '55B',
  }),
  openWeight({
    slug: 'mistral-large-3',
    displayName: 'Mistral Large 3',
    monogram: 'M5',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-large-2512',
    apiBase: OPENROUTER,
    etaSeconds: 12,
    family: 'mistral',
    weightClass: 'super-heavy',
    runSizeGb: 368,
    totalParams: '675B',
    activeParams: '41B',
  }),
  openWeight({
    slug: 'mistral-large-4',
    displayName: 'Mistral Large 4',
    monogram: 'M4',
    publisher: 'Mistral',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-large-4-0',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'mistral',
    weightClass: 'super-heavy',
    runSizeGb: 368,
    totalParams: '675B',
    activeParams: '41B',
  }),
  openWeight({
    slug: 'kimi-k2-6',
    displayName: 'Kimi K2.6',
    monogram: 'K2',
    publisher: 'Moonshot AI',
    provider: 'openrouter',
    apiModelId: 'moonshotai/kimi-k2.6',
    apiBase: OPENROUTER,
    etaSeconds: 18,
    family: 'kimi',
    weightClass: 'super-heavy',
    runSizeGb: 600,
    totalParams: '1T',
    activeParams: '32B',
  }),
  openWeight({
    slug: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    monogram: 'DP',
    publisher: 'DeepSeek',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4-pro',
    apiBase: OPENROUTER,
    etaSeconds: 13,
    family: 'deepseek',
    weightClass: 'super-heavy',
    runSizeGb: 1008,
    totalParams: '1.6T',
    activeParams: '49B',
  }),
  openWeight({
    slug: 'kimi-k3',
    displayName: 'Kimi K3',
    monogram: 'K3',
    publisher: 'Moonshot AI',
    provider: 'openrouter',
    apiModelId: 'moonshotai/kimi-k3',
    apiBase: OPENROUTER,
    etaSeconds: 20,
    family: 'kimi',
    weightClass: 'super-heavy',
    runSizeGb: 1548,
    totalParams: '2.8T',
  }),

  // Closed frontier models
  frontier({
    slug: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    monogram: 'C6',
    publisher: 'Anthropic',
    provider: 'openrouter',
    apiModelId: 'anthropic/claude-opus-5.5',
    apiBase: OPENROUTER,
    etaSeconds: 24,
    family: 'claude',
  }),
  frontier({
    slug: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    monogram: 'C5',
    publisher: 'Anthropic',
    provider: 'openrouter',
    apiModelId: 'anthropic/claude-opus-5',
    apiBase: OPENROUTER,
    etaSeconds: 22,
    family: 'claude',
  }),
  frontier({
    slug: 'gpt-6-1-sol',
    displayName: 'GPT-6.1 Sol',
    monogram: 'O6',
    publisher: 'OpenAI',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-6.1-sol',
    apiBase: OPENROUTER,
    etaSeconds: 20,
    family: 'gpt',
  }),
  frontier({
    slug: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    monogram: 'O5',
    publisher: 'OpenAI',
    provider: 'openrouter',
    apiModelId: 'openai/gpt-6-sol',
    apiBase: OPENROUTER,
    etaSeconds: 18,
    family: 'gpt',
  }),
  frontier({
    slug: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    monogram: 'GM',
    publisher: 'Google',
    provider: 'openrouter',
    apiModelId: 'google/gemini-4-argon',
    apiBase: OPENROUTER,
    etaSeconds: 16,
    family: 'gemini',
  }),
  frontier({
    slug: 'gemini-3-8-flash',
    displayName: 'Gemini 3.8 Flash',
    monogram: 'G8',
    publisher: 'Google',
    provider: 'openrouter',
    apiModelId: 'google/gemini-3.8-flash',
    apiBase: OPENROUTER,
    etaSeconds: 9,
    family: 'gemini',
  }),
  frontier({
    slug: 'grok-4-7',
    displayName: 'Grok 4.7',
    monogram: 'X7',
    publisher: 'xAI',
    provider: 'openrouter',
    apiModelId: 'x-ai/grok-4.7',
    apiBase: OPENROUTER,
    etaSeconds: 14,
    family: 'grok',
  }),
  frontier({
    slug: 'grok-4-6',
    displayName: 'Grok 4.6',
    monogram: 'X6',
    publisher: 'xAI',
    provider: 'openrouter',
    apiModelId: 'x-ai/grok-4.6',
    apiBase: OPENROUTER,
    etaSeconds: 13,
    family: 'grok',
  }),
  frontier({
    slug: 'command-a-plus',
    displayName: 'Command A+',
    monogram: 'CA',
    publisher: 'Cohere',
    provider: 'openrouter',
    apiModelId: 'cohere/command-a-plus',
    apiBase: OPENROUTER,
    etaSeconds: 8,
    family: 'command',
  }),
  frontier({
    slug: 'command-a',
    displayName: 'Command A',
    monogram: 'CO',
    publisher: 'Cohere',
    provider: 'openrouter',
    apiModelId: 'cohere/command-a',
    apiBase: OPENROUTER,
    etaSeconds: 10,
    family: 'command',
  }),
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
  for (const entry of entries) {
    slugCounts.set(entry.slug, (slugCounts.get(entry.slug) ?? 0) + 1);
    apiIdCounts.set(entry.apiModelId, (apiIdCounts.get(entry.apiModelId) ?? 0) + 1);

    // Monograms may repeat: they are decoration beside the display name.
    if (!entry.monogram.trim()) {
      problems.push({ code: 'missing_monogram', slug: entry.slug });
    }
    if (!entry.avatarUrl.trim()) {
      problems.push({ code: 'missing_avatar', slug: entry.slug });
    }
    if (!entry.publisher.trim()) {
      problems.push({ code: 'missing_publisher', slug: entry.slug });
    }
    if (!Number.isInteger(entry.etaSeconds) || entry.etaSeconds <= 0) {
      problems.push({ code: 'invalid_eta', slug: entry.slug });
    }

    if (entry.openWeights) {
      if (!entry.weightClass) {
        problems.push({ code: 'missing_weight_class', slug: entry.slug });
      }
      if (entry.runSizeGb === null || !(entry.runSizeGb > 0)) {
        problems.push({ code: 'missing_run_size', slug: entry.slug });
      }
      if (!entry.totalParams) {
        problems.push({ code: 'missing_total_params', slug: entry.slug });
      }
    } else {
      if (entry.weightClass !== null) {
        problems.push({ code: 'weight_class_on_frontier', slug: entry.slug });
      }
      if (entry.runSizeGb !== null) {
        problems.push({ code: 'run_size_on_frontier', slug: entry.slug });
      }
      if (entry.totalParams !== null || entry.activeParams !== null) {
        problems.push({ code: 'params_on_frontier', slug: entry.slug });
      }
    }
  }

  for (const [slug, count] of slugCounts) {
    if (count > 1) problems.push({ code: 'duplicate_slug', slug });
  }
  for (const [apiModelId, count] of apiIdCounts) {
    if (count > 1) problems.push({ code: 'duplicate_api_model_id', apiModelId });
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

/**
 * Database rows carry only callable identity. Weight class, Run size, parameter
 * counts, publisher, family and the Model's icon stay in the registry and are
 * re-attached by slug at read time, so a reclassification or a new logo
 * relabels history without a migration.
 */
export function modelRegistryRows() {
  return MODEL_REGISTRY.map(
    ({
      avatarUrl: _avatarUrl,
      family: _family,
      publisher: _publisher,
      weightClass: _weightClass,
      runSizeGb: _runSizeGb,
      totalParams: _totalParams,
      activeParams: _activeParams,
      ...entry
    }) => ({
      id: uuidv7(),
      ...entry,
      enabled: true,
    }),
  );
}
