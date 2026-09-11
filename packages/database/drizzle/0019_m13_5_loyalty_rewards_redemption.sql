ALTER TABLE "loyalty_rewards"
  ADD COLUMN IF NOT EXISTS "reward_type" varchar(32) NOT NULL DEFAULT 'fixed_discount',
  ADD COLUMN IF NOT EXISTS "fulfillment_target_type" varchar(32) NOT NULL DEFAULT 'fixed_discount',
  ADD COLUMN IF NOT EXISTS "fulfillment_discount_minor" bigint,
  ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "per_customer_usage_limit" integer DEFAULT 1;
--> statement-breakpoint
UPDATE "loyalty_rewards"
SET "fulfillment_discount_minor" = NULL
WHERE "fulfillment_discount_minor" IS NULL;
--> statement-breakpoint
ALTER TABLE "loyalty_rewards"
  ADD CONSTRAINT "loyalty_rewards_type_check" CHECK ("reward_type" = 'fixed_discount'),
  ADD CONSTRAINT "loyalty_rewards_target_type_check" CHECK ("fulfillment_target_type" = 'fixed_discount'),
  ADD CONSTRAINT "loyalty_rewards_discount_check" CHECK ("fulfillment_discount_minor" IS NULL OR "fulfillment_discount_minor" BETWEEN 1 AND 2147483647),
  ADD CONSTRAINT "loyalty_rewards_usage_limit_check" CHECK ("per_customer_usage_limit" IS NULL OR "per_customer_usage_limit" BETWEEN 1 AND 2147483647),
  ADD CONSTRAINT "loyalty_rewards_archive_visibility_check" CHECK (NOT "is_archived" OR NOT "is_visible");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_reward_versions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reward_id" integer NOT NULL,
  "version" integer NOT NULL,
  "action" varchar(16) NOT NULL,
  "code" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" varchar(2048) NOT NULL,
  "cost_coal" integer NOT NULL,
  "reward_type" varchar(32) NOT NULL,
  "fulfillment_target_type" varchar(32) NOT NULL,
  "fulfillment_discount_minor" bigint NOT NULL,
  "is_visible" boolean NOT NULL,
  "is_archived" boolean NOT NULL,
  "active_from" timestamp with time zone,
  "active_until" timestamp with time zone,
  "sort_order" integer NOT NULL,
  "per_customer_usage_limit" integer,
  "actor_staff_user_id" integer NOT NULL,
  "request_id" varchar(160) NOT NULL,
  "payload_fingerprint" varchar(64) NOT NULL,
  "idempotency_key" varchar(255) NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "loyalty_reward_versions_reward_id_loyalty_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "loyalty_rewards"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "loyalty_reward_versions_actor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "staff_users"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "loyalty_reward_versions_reward_version_unique" UNIQUE ("reward_id", "version"),
  CONSTRAINT "loyalty_reward_versions_action_check" CHECK ("action" IN ('created', 'updated', 'archived')),
  CONSTRAINT "loyalty_reward_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "loyalty_reward_versions_type_check" CHECK ("reward_type" = 'fixed_discount' AND "fulfillment_target_type" = 'fixed_discount'),
  CONSTRAINT "loyalty_reward_versions_cost_check" CHECK ("cost_coal" BETWEEN 1 AND 2147483647),
  CONSTRAINT "loyalty_reward_versions_discount_check" CHECK ("fulfillment_discount_minor" BETWEEN 1 AND 2147483647),
  CONSTRAINT "loyalty_reward_versions_archive_visibility_check" CHECK (NOT "is_archived" OR NOT "is_visible"),
  CONSTRAINT "loyalty_reward_versions_request_id_check" CHECK (length(btrim("request_id")) > 0),
  CONSTRAINT "loyalty_reward_versions_payload_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "loyalty_reward_versions_idempotency_check" CHECK (length(btrim("idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_reward_versions_reward_created_at_idx" ON "loyalty_reward_versions" USING btree ("reward_id", "created_at", "id");
--> statement-breakpoint
ALTER TABLE "loyalty_redemptions"
  ADD COLUMN IF NOT EXISTS "reward_type" varchar(32) NOT NULL DEFAULT 'fixed_discount',
  ADD COLUMN IF NOT EXISTS "fulfillment_target_type" varchar(32) NOT NULL DEFAULT 'fixed_discount',
  ADD COLUMN IF NOT EXISTS "discount_minor" bigint,
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "loyalty_redemptions"
SET "discount_minor" = COALESCE("discount_minor", 1),
    "expires_at" = COALESCE("expires_at", "created_at" + interval '30 days');
--> statement-breakpoint
ALTER TABLE "loyalty_redemptions"
  ALTER COLUMN "discount_minor" SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ADD CONSTRAINT "loyalty_redemptions_type_check" CHECK ("reward_type" = 'fixed_discount' AND "fulfillment_target_type" = 'fixed_discount'),
  ADD CONSTRAINT "loyalty_redemptions_discount_check" CHECK ("discount_minor" BETWEEN 1 AND 2147483647),
  ADD CONSTRAINT "loyalty_redemptions_expiry_check" CHECK ("expires_at" > "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_redemption_orders" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "redemption_id" integer NOT NULL UNIQUE,
  "order_id" integer NOT NULL UNIQUE,
  "customer_id" integer NOT NULL,
  "reward_code" varchar(80) NOT NULL,
  "reward_name" varchar(160) NOT NULL,
  "discount_minor" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "loyalty_redemption_orders_redemption_id_loyalty_redemptions_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "loyalty_redemptions"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "loyalty_redemption_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "loyalty_redemption_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE cascade,
  CONSTRAINT "loyalty_redemption_orders_code_not_blank_check" CHECK (length(btrim("reward_code")) > 0),
  CONSTRAINT "loyalty_redemption_orders_name_not_blank_check" CHECK (length(btrim("reward_name")) > 0),
  CONSTRAINT "loyalty_redemption_orders_discount_check" CHECK ("discount_minor" BETWEEN 1 AND 2147483647)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_redemption_orders_customer_created_at_idx" ON "loyalty_redemption_orders" USING btree ("customer_id", "created_at", "id");
