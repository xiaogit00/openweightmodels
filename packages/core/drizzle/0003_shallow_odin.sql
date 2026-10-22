CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comparisons" ADD COLUMN "takedown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comparisons" ADD COLUMN "takedown_by_id" uuid;--> statement-breakpoint
ALTER TABLE "comparisons" ADD COLUMN "takedown_reason" text;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_takedown_by_id_users_id_fk" FOREIGN KEY ("takedown_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comparisons_takedown_idx" ON "comparisons" USING btree ("takedown_at");