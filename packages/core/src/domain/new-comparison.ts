/** Creation rules shared by the New Comparison form and its tests. */

import { MAX_PROMPT_CHARS } from './upload';

export const DEFAULT_MAX_CHALLENGERS = 4;

export type SelectableModel = {
  id: string;
  slug: string;
  displayName: string;
  etaSeconds: number;
};

/** Server and form both derive the Challenger cap from the same env value. */
export function resolveMaxChallengers(
  value: string | number | null | undefined,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHALLENGERS;
}

function normalise(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Front-matter `model:` may name a registry slug or a display name. An
 * unrecognised value returns null so the form can prompt the author to pick.
 */
export function matchModelFromFrontMatter<T extends SelectableModel>(
  value: string | null | undefined,
  models: readonly T[],
): T | null {
  const key = normalise(value ?? '');
  if (!key) return null;
  return (
    models.find(
      (model) =>
        normalise(model.slug) === key || normalise(model.displayName) === key,
    ) ?? null
  );
}

export function challengerDisabled(
  modelId: string,
  baseModelId: string | null,
  challengerIds: readonly string[],
  maxChallengers = DEFAULT_MAX_CHALLENGERS,
) {
  if (modelId === baseModelId) return true;
  return !challengerIds.includes(modelId) && challengerIds.length >= maxChallengers;
}

export function toggleChallenger(
  modelId: string,
  baseModelId: string | null,
  challengerIds: readonly string[],
  maxChallengers = DEFAULT_MAX_CHALLENGERS,
): string[] {
  if (modelId === baseModelId) return [...challengerIds];
  if (challengerIds.includes(modelId)) {
    return challengerIds.filter((id) => id !== modelId);
  }
  if (challengerIds.length >= maxChallengers) return [...challengerIds];
  return [...challengerIds, modelId];
}

export type ScheduleEstimate = {
  ready: boolean;
  hint: string;
};

export type BaseSource = 'upload' | 'write';

export function describeSchedule(input: {
  /** Which tab supplies the Base output. Defaults to the upload tab. */
  baseSource?: BaseSource;
  hasFile: boolean;
  /** Whether the "Write a prompt" tab has a pasted Base output. */
  hasBaseOutput?: boolean;
  baseModelId: string | null;
  challengerIds: readonly string[];
  prompt: string;
  models: readonly SelectableModel[];
}): ScheduleEstimate {
  const baseSource = input.baseSource ?? 'upload';
  if (baseSource === 'upload' && !input.hasFile) {
    return { ready: false, hint: 'Upload a base output to continue' };
  }
  if (baseSource === 'write' && !input.hasBaseOutput) {
    return { ready: false, hint: 'Paste the base output to continue' };
  }
  if (!input.baseModelId) {
    return { ready: false, hint: 'Pick the model that generated it' };
  }
  if (!input.challengerIds.length) {
    return { ready: false, hint: 'Choose at least one model to compare' };
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return { ready: false, hint: 'Add a prompt to schedule' };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      ready: false,
      hint: `Prompts are limited to ${MAX_PROMPT_CHARS.toLocaleString('en-US')} characters`,
    };
  }

  const selected = input.models.filter((model) =>
    input.challengerIds.includes(model.id),
  );
  const calls = input.challengerIds.length;
  const slowestEtaSeconds = Math.max(0, ...selected.map((model) => model.etaSeconds));
  const callLabel = calls === 1 ? 'hosted API call' : 'hosted API calls';

  return {
    ready: true,
    hint: `${calls} ${callLabel} · ~${slowestEtaSeconds}s`,
  };
}
