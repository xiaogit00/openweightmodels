import { getBoardFacets } from '@owm/core';
import { apiError, json } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return json(await getBoardFacets());
  } catch (error) {
    return apiError(error);
  }
}
