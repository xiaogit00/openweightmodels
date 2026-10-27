import { uuidv7 } from 'uuidv7';

export type ModelRegistryEntry = {
  slug: string;
  displayName: string;
  monogram: string;
  provider: string;
  apiModelId: string;
  apiBase: string;
  etaSeconds: number;
};

/**
 * The curated Model registry. Docker Compose seeds it with the development
 * content; production bootstraps it with `pnpm db:bootstrap`, which upserts
 * these rows and never creates users, Comparisons or other fake content.
 */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    slug: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B',
    monogram: 'L3',
    provider: 'openrouter',
    apiModelId: 'meta-llama/llama-3.3-70b-instruct',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 8,
  },
  {
    slug: 'qwen-2-5-72b',
    displayName: 'Qwen2.5 72B',
    monogram: 'Q2',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen-2.5-72b-instruct',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
  },
  {
    slug: 'deepseek-v3',
    displayName: 'DeepSeek V3',
    monogram: 'DS',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-chat',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 9,
  },
  {
    slug: 'deepseek-v4-1-flash',
    displayName: 'DeepSeek V4.1 Flash 1017',
    monogram: 'D4',
    provider: 'openrouter',
    apiModelId: 'deepseek/deepseek-v4.1-flash-1017',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
  },
  {
    slug: 'mistral-large',
    displayName: 'Mistral Large',
    monogram: 'MI',
    provider: 'openrouter',
    apiModelId: 'mistralai/mistral-large',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 5,
  },
  {
    slug: 'gemma-2-27b',
    displayName: 'Gemma 2 27B',
    monogram: 'G2',
    provider: 'openrouter',
    apiModelId: 'google/gemma-2-27b-it',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 7,
  },
  {
    slug: 'phi-4',
    displayName: 'Phi-4',
    monogram: 'P4',
    provider: 'openrouter',
    apiModelId: 'microsoft/phi-4',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 4,
  },
  {
    slug: 'codestral',
    displayName: 'Codestral',
    monogram: 'CS',
    provider: 'openrouter',
    apiModelId: 'mistralai/codestral-2508',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 5,
  },
  {
    slug: 'qwen-2-5-coder',
    displayName: 'Qwen2.5 Coder',
    monogram: 'QC',
    provider: 'openrouter',
    apiModelId: 'qwen/qwen-2.5-coder-32b-instruct',
    apiBase: 'https://openrouter.ai/api/v1',
    etaSeconds: 6,
  },
];

export function modelRegistryRows() {
  return MODEL_REGISTRY.map((entry) => ({
    id: uuidv7(),
    ...entry,
    enabled: true,
  }));
}
