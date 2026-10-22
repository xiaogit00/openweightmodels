/**
 * Adds enough published Comparisons to the isolated E2E database to exercise
 * Board pagination (48 per page). Runs after the deterministic dev seed.
 */
import { uuidv7 } from 'uuidv7';
import { CATEGORIES, closeDb, comparisons, getDb, jobs, models, responses, users } from '@owm/core';

const COUNT = 56;

async function main() {
  const db = getDb();
  const userRows = await db.select({ id: users.id }).from(users);
  const modelRows = await db.select({ id: models.id, slug: models.slug }).from(models);

  if (!userRows.length || modelRows.length < 2) {
    throw new Error('[e2e] seed the database before adding Board pagination fixtures');
  }

  const now = Date.now();
  const comparisonRows: Array<typeof comparisons.$inferInsert> = [];
  const jobRows: Array<typeof jobs.$inferInsert> = [];
  const responseRows: Array<typeof responses.$inferInsert> = [];

  for (let index = 0; index < COUNT; index += 1) {
    const comparisonId = uuidv7();
    const jobId = uuidv7();
    const author = userRows[index % userRows.length]!;
    const baseModel = modelRows[index % modelRows.length]!;
    const challengerModel = modelRows[(index + 1) % modelRows.length]!;
    const publishedAt = new Date(now - index * 60_000);
    const category = CATEGORIES[index % CATEGORIES.length]!;
    const title = `Board fixture ${String(index + 1).padStart(2, '0')}`;

    comparisonRows.push({
      id: comparisonId,
      authorId: author.id,
      title,
      prompt: `${title}: explain the trade-offs of a bounded queue.`,
      categories: [category],
      effort: ((index % 3) + 1) as 1 | 2 | 3,
      baseModelId: baseModel.id,
      status: 'published',
      publishedAt,
      createdAt: publishedAt,
      commentCount: index % 7,
      annotationCount: index % 4,
    });
    jobRows.push({ id: jobId, comparisonId, status: 'ready', finishedAt: publishedAt });
    responseRows.push(
      {
        id: uuidv7(),
        comparisonId,
        jobId,
        modelId: baseModel.id,
        isBase: true,
        contentMd: `${title}: the base answer explains the bounded queue and its backpressure.`,
        tokens: 42 + index,
        latencyMs: 0,
        status: 'done',
        finishedAt: publishedAt,
      },
      {
        id: uuidv7(),
        comparisonId,
        jobId,
        modelId: challengerModel.id,
        isBase: false,
        contentMd: `${title}: the challenger compares a ring buffer with a channel.`,
        tokens: 64 + index,
        latencyMs: 900 + index,
        status: 'done',
        finishedAt: publishedAt,
      },
    );
  }

  await db.transaction(async (tx) => {
    await tx.insert(comparisons).values(comparisonRows);
    await tx.insert(jobs).values(jobRows);
    await tx.insert(responses).values(responseRows);
  });

  console.log(`[e2e] added ${COUNT} published Board fixtures`);
}

main()
  .then(closeDb)
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
