import {
  BOARD_PAGE_SIZE,
  CATEGORIES,
  createComparison,
  decodeUtf8,
  listComparisons,
  parseBoardFilters,
  validateFileSize,
  type ConversationTurnInput,
} from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { enforceRunLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters = parseBoardFilters(params);
    const limitParam = params.get('limit');
    const requestedLimit = Number(limitParam);
    const limit =
      limitParam && Number.isFinite(requestedLimit) ? requestedLimit : BOARD_PAGE_SIZE;

    const result = await listComparisons({
      ...filters,
      cursor: params.get('cursor'),
      limit,
    });

    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRunLimit(user.id);
    const form = await request.formData();
    const file = form.get('file');
    const baseOutput = String(form.get('base_output') ?? '');
    const turnsRaw = form.get('turns');
    const hasFile = file instanceof File;
    const hasBaseOutput = Boolean(baseOutput.trim());
    const hasTurns = typeof turnsRaw === 'string' && turnsRaw.trim().length > 0;

    if (!hasFile && !hasBaseOutput && !hasTurns) {
      return json(
        {
          error: {
            code: 'file_required',
            message: 'Upload a base output, paste one, or provide a turn script.',
          },
        },
        { status: 400 },
      );
    }
    if ([hasFile, hasBaseOutput, hasTurns].filter(Boolean).length > 1) {
      return json(
        {
          error: {
            code: 'base_conflict',
            message: 'Provide a file, a pasted base output, or a turn script — not more than one.',
          },
        },
        { status: 400 },
      );
    }

    let turns: ConversationTurnInput[] | null = null;
    if (hasTurns) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(turnsRaw));
      } catch {
        return json(
          {
            error: {
              code: 'invalid_turns',
              message: 'The turn script is not valid JSON.',
            },
          },
          { status: 400 },
        );
      }
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (turn) =>
            typeof turn !== 'object' ||
            turn === null ||
            typeof (turn as { prompt?: unknown }).prompt !== 'string' ||
            typeof (turn as { baseOutput?: unknown }).baseOutput !== 'string',
        )
      ) {
        return json(
          {
            error: {
              code: 'invalid_turns',
              message: 'Each turn needs a prompt and a baseOutput string.',
            },
          },
          { status: 400 },
        );
      }
      turns = parsed.map((turn) => ({
        prompt: (turn as ConversationTurnInput).prompt,
        baseOutput: (turn as ConversationTurnInput).baseOutput,
      }));
    }

    let uploaded: { fileName: string; fileText: string } | null = null;
    if (file instanceof File) {
      validateFileSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      uploaded = { fileName: file.name, fileText: decodeUtf8(bytes) };
    }

    const baseModelId = String(form.get('base_model_id') ?? '');
    const prompt = String(form.get('prompt') ?? '');
    const title = String(form.get('title') ?? '');
    const effort = Number(form.get('effort') ?? 1);
    const modelIds = [
      ...form.getAll('model_ids'),
      ...form.getAll('model_ids[]'),
    ].map(String);
    const categories = form
      .getAll('categories')
      .map(String)
      .filter((value) => (CATEGORIES as readonly string[]).includes(value));

    const result = await createComparison({
      authorId: user.id,
      ...(uploaded ?? (turns ? { turns } : { baseOutput })),
      baseModelId,
      prompt,
      modelIds,
      title,
      categories,
      effort,
    });

    return json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
