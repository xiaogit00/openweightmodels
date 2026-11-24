CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_categories" (
	"comparison_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "comparison_categories_comparison_id_category_id_pk" PRIMARY KEY("comparison_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_categories" ADD CONSTRAINT "comparison_categories_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_categories" ADD CONSTRAINT "comparison_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "comparison_categories_comparison_idx" ON "comparison_categories" USING btree ("comparison_id");--> statement-breakpoint
CREATE INDEX "comparison_categories_category_idx" ON "comparison_categories" USING btree ("category_id");--> statement-breakpoint
INSERT INTO "categories" ("id", "slug", "display_name", "featured") VALUES
	('019a0000-0000-7000-8000-000000000001', 'coding', 'Coding', true),
	('019a0000-0000-7000-8000-000000000002', 'reasoning', 'Reasoning', true),
	('019a0000-0000-7000-8000-000000000003', 'creative', 'Creative', true),
	('019a0000-0000-7000-8000-000000000004', 'math', 'Math', true),
	('019a0000-0000-7000-8000-000000000005', 'long-context', 'Long-context', true),
	('019a0000-0000-7000-8000-000000000006', 'language', 'Language', true),
	('019a0000-0000-7000-8000-000000000007', 'agents', 'Agents', true),
	('019a0000-0000-7000-8000-000000000008', 'tool-use', 'Tool use', true),
	('019a0000-0000-7000-8000-000000000009', 'data-analysis', 'Data analysis', true),
	('019a0000-0000-7000-8000-00000000000a', 'translation', 'Translation', true),
	('019a0000-0000-7000-8000-00000000000b', 'security', 'Security', true),
	('019a0000-0000-7000-8000-00000000000c', 'roleplay', 'Roleplay', true)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "comparison_categories" ("comparison_id", "category_id", "position")
SELECT
	"comparisons"."id",
	"categories"."id",
	("legacy"."ordinality" - 1)::smallint
FROM "comparisons"
CROSS JOIN LATERAL unnest("comparisons"."categories") WITH ORDINALITY AS "legacy"("name", "ordinality")
JOIN "categories" ON "categories"."slug" = trim(both '-' from lower(regexp_replace("legacy"."name", '[^a-zA-Z0-9]+', '-', 'g')))
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "comparisons" DROP COLUMN "categories";