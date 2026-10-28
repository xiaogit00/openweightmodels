import {
  BOARD_PAGE_SIZE,
  CATEGORIES,
  createComparison,
  decodeUtf8,
  listComparisons,
  parseBoardFilters,
  validateFileSize,
} from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireUser } from '@/lib/auth';

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
    const form = await request.formData();
    const file = form.get('file');
    const baseOutput = String(form.get('base_output') ?? '');
    const hasFile = file instanceof File;
    const hasBaseOutput = Boolean(baseOutput.trim());

    if (!hasFile && !hasBaseOutput) {
      return json(
        {
          error: {
            code: 'file_required',
            message: 'Upload a base output or paste one.',
          },
        },
        { status: 400 },
      );
    }
    if (hasFile && hasBaseOutput) {
      return json(
        {
          error: {
            code: 'base_conflict',
            message: 'Provide either a file or a pasted base output, not both.',
          },
        },
        { status: 400 },
      );
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
      ...(uploaded ?? { baseOutput }),
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
