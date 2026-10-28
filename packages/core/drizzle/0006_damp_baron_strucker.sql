CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comparison_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turns_comparison_position_unique" ON "turns" USING btree ("comparison_id","position");--> statement-breakpoint
CREATE INDEX "turns_comparison_idx" ON "turns" USING btree ("comparison_id");--> statement-breakpoint
-- Backfill: every existing Comparison becomes a one-Turn Conversation.
-- Turns are minted as UUIDv7 in SQL: 48-bit unix-ms prefix, version 7, variant
-- 10xx, then random hex. Postgres 17 has no uuidv7(), and the app-side
-- generator cannot reach historical rows from a migration.
INSERT INTO "turns" ("id", "comparison_id", "position", "prompt", "created_at")
SELECT
  (
    lpad(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
    || '7'
    || substr(md5(random()::text), 1, 3)
    || substr('89ab', 1 + floor(random() * 4)::int, 1)
    || substr(md5(random()::text || clock_timestamp()::text), 1, 15)
  )::uuid,
  "id",
  0,
  "prompt",
  "created_at"
FROM "comparisons";--> statement-breakpoint
-- Add the column nullable so existing Responses can be attached to their Turn,
-- then make it required. A Response without a Turn is not a valid row.
ALTER TABLE "responses" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
UPDATE "responses" AS "r"
SET "turn_id" = "t"."id"
FROM "turns" AS "t"
WHERE "t"."comparison_id" = "r"."comparison_id" AND "t"."position" = 0;--> statement-breakpoint
ALTER TABLE "responses" ALTER COLUMN "turn_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "responses_comparison_model_unique";--> statement-breakpoint
DROP INDEX "responses_one_base_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "responses_turn_model_unique" ON "responses" USING btree ("turn_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_one_base_per_turn_unique" ON "responses" USING btree ("turn_id") WHERE "responses"."is_base" = true;--> statement-breakpoint
CREATE INDEX "responses_comparison_idx" ON "responses" USING btree ("comparison_id");
