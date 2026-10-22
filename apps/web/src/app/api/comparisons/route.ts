import { CATEGORIES, createComparison, decodeUtf8, listComparisons, validateFileSize } from '@owm/core';
import type { Sort } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const sortRaw = params.get('sort');
    const sort: Sort = sortRaw === 'top' || sortRaw === 'new' ? sortRaw : 'live';
    const effort = params.get('effort') ? Number(params.get('effort')) : null;

    const result = await listComparisons({
      cat: params.get('cat'),
      models: (params.get('models') ?? '').split(',').filter(Boolean),
      effort: effort && [1, 2, 3].includes(effort) ? effort : null,
      q: params.get('q'),
      sort,
      cursor: params.get('cursor'),
      limit: params.get('limit') ? Number(params.get('limit')) : 48,
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
    if (!(file instanceof File)) {
      return json({ error: { code: 'file_required', message: 'Upload a base output.' } }, { status: 400 });
    }

    validateFileSize(file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileText = decodeUtf8(bytes);

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
      fileName: file.name,
      fileText,
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
