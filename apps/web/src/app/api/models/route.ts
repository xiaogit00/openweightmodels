import { getModels } from '@owm/core';
import { json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const models = await getModels();
  return json({
    models: models.map((model) => ({
      id: model.id,
      slug: model.slug,
      name: model.displayName,
      monogram: model.monogram,
      etaSeconds: model.etaSeconds,
      provider: model.provider,
      openWeights: model.openWeights,
    })),
  });
}
