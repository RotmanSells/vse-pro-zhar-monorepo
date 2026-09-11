ALTER TABLE "categories"
  ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_version_check" CHECK ("categories"."version" > 0);
--> statement-breakpoint
CREATE TABLE "category_versions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "category_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "category_id" integer NOT NULL,
  "version" integer NOT NULL,
  "action" varchar(16) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "sort_order" integer NOT NULL,
  "is_visible" boolean NOT NULL,
  "actor_staff_user_id" integer NOT NULL,
  "request_id" varchar(160) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "payload_fingerprint" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "category_versions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "category_versions_actor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "category_versions_idempotency_key_unique" UNIQUE("idempotency_key"),
  CONSTRAINT "category_versions_category_version_unique" UNIQUE("category_id", "version"),
  CONSTRAINT "category_versions_action_check" CHECK ("action" IN ('created', 'updated', 'archived')),
  CONSTRAINT "category_versions_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "category_versions_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "category_versions_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "category_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "category_versions_request_id_check" CHECK (length(btrim("request_id")) > 0),
  CONSTRAINT "category_versions_idempotency_key_check" CHECK (length(btrim("idempotency_key")) > 0),
  CONSTRAINT "category_versions_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "category_versions_category_created_at_idx"
  ON "category_versions" USING btree ("category_id", "created_at", "id");
