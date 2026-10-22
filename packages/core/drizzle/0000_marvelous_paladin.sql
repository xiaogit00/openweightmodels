CREATE TABLE "activity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"comparison_id" uuid,
	"model_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"annotation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comparison_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"about_model_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"categories" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"effort" smallint DEFAULT 1 NOT NULL,
	"base_model_id" uuid NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"annotation_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"response_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comparison_id" uuid NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"monogram" text NOT NULL,
	"provider" text NOT NULL,
	"api_base" text,
	"api_model_id" text,
	"eta_seconds" integer DEFAULT 8 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comparison_id" uuid NOT NULL,
	"job_id" uuid,
	"model_id" uuid NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_messages" ADD CONSTRAINT "annotation_messages_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_messages" ADD CONSTRAINT "annotation_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_about_model_id_models_id_fk" FOREIGN KEY ("about_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_base_model_id_models_id_fk" FOREIGN KEY ("base_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "annotation_messages_annotation_idx" ON "annotation_messages" USING btree ("annotation_id");--> statement-breakpoint
CREATE INDEX "annotations_response_idx" ON "annotations" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "comments_comparison_idx" ON "comments" USING btree ("comparison_id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comparisons_published_at_idx" ON "comparisons" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "comparisons_created_at_idx" ON "comparisons" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comparisons_status_idx" ON "comparisons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_comparison_idx" ON "jobs" USING btree ("comparison_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_slug_unique" ON "models" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_comparison_model_unique" ON "responses" USING btree ("comparison_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_one_base_unique" ON "responses" USING btree ("comparison_id") WHERE "responses"."is_base" = true;--> statement-breakpoint
CREATE INDEX "responses_job_idx" ON "responses" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_unique" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_target_unique" ON "votes" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "votes_target_idx" ON "votes" USING btree ("target_type","target_id");