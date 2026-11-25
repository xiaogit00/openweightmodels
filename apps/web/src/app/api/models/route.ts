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
      avatarUrl: model.avatarUrl,
      etaSeconds: model.etaSeconds,
      provider: model.provider,
      publisher: model.publisher,
      openWeights: model.openWeights,
      family: model.family,
      weightClass: model.weightClass,
      runSizeGb: model.runSizeGb,
      totalParams: model.totalParams,
      activeParams: model.activeParams,
    })),
  });
}
