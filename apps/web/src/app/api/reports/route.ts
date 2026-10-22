import { createReport } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { reportCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = reportCreateSchema.parse(await readJson(request));
    const report = await createReport({ ...body, reporterId: user.id });
    return json({ report }, { status: report.duplicate ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
