import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uuidv7 } from 'uuidv7';
import { servicesAvailable } from './index';

const available = await servicesAvailable();

const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));

/** Statement bodies, exactly as drizzle's migrator splits them. */
function statements(tag: string) {
  return readFileSync(`${migrations}${tag}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const temporaryDatabases: string[] = [];

afterAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  for (const database of temporaryDatabases) {
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
  }
  await admin.end({ timeout: 5 });
});

async function temporaryDatabase() {
  const url = new URL(process.env.DATABASE_URL!);
  const database = `owm_categories_${uuidv7().replace(/-/g, '').slice(-12)}`;
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${database}"`);
  temporaryDatabases.push(database);
  const target = new URL(process.env.DATABASE_URL!);
  target.pathname = `/${database}`;
  return postgres(target.toString(), { max: 1, onnotice: () => {} });
}

describe.skipIf(!available)('legacy Category migration', () => {
  it('backfills the six legacy values into join rows against the preset slugs', async () => {
    const sql = await temporaryDatabase();
    try {
      const before = [
        '0000_marvelous_paladin.sql',
        '0001_fuzzy_tag.sql',
        '0002_modern_lucky_pierre.sql',
        '0003_shallow_odin.sql',
        '0004_chilly_living_mummy.sql',
        '0005_stiff_mandroid.sql',
        '0006_damp_baron_strucker.sql',
        '0007_sleepy_venus.sql',
      ];
      for (const tag of before) {
        for (const statement of statements(tag)) await sql.unsafe(statement);
      }

      const userId = uuidv7();
      const modelId = uuidv7();
      const comparisonId = uuidv7();
      await sql`
        insert into users (id, handle) values (${userId}, ${'legacy-reader'})
      `;
      await sql`
        insert into models (id, slug, display_name, monogram, provider)
        values (${modelId}, ${'legacy-model'}, ${'Legacy Model'}, ${'LM'}, ${'mock'})
      `;
      await sql`
        insert into comparisons (id, author_id, title, prompt, categories, base_model_id, status)
        values (
          ${comparisonId},
          ${userId},
          ${'Legacy comparison'},
          ${'Explain the queue.'},
          ${['Language', 'Coding']},
          ${modelId},
          ${'published'}
        )
      `;

      for (const statement of statements('0008_community_categories.sql')) {
        await sql.unsafe(statement);
      }

      const joinRows = await sql<{ slug: string; position: number }[]>`
        select categories.slug, comparison_categories.position
        from comparison_categories
        join categories on categories.id = comparison_categories.category_id
        where comparison_categories.comparison_id = ${comparisonId}
        order by comparison_categories.position
      `;
      expect(joinRows).toEqual([
        { slug: 'language', position: 0 },
        { slug: 'coding', position: 1 },
      ]);

      const categoryRows = await sql<{ slug: string }[]>`
        select slug from categories order by slug
      `;
      expect(categoryRows.map((row) => row.slug)).toContain('agents');
      expect(categoryRows).toHaveLength(12);

      const legacyColumn = await sql`
        select 1
        from information_schema.columns
        where table_name = 'comparisons' and column_name = 'categories'
      `;
      expect(legacyColumn).toHaveLength(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
