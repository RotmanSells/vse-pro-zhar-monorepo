CREATE TABLE "loyalty_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loyalty_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"coal_balance" integer DEFAULT 0 NOT NULL,
	"rank_code" varchar(32) DEFAULT 'spark' NOT NULL,
	"rank_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_accounts_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "loyalty_accounts_xp_check" CHECK ("loyalty_accounts"."xp" BETWEEN 0 AND 2147483647),
	CONSTRAINT "loyalty_accounts_coal_balance_check" CHECK ("loyalty_accounts"."coal_balance" BETWEEN 0 AND 2147483647),
	CONSTRAINT "loyalty_accounts_rank_code_check" CHECK ("loyalty_accounts"."rank_code" IN ('spark', 'heat', 'flame', 'volcano')),
	CONSTRAINT "loyalty_accounts_rank_version_check" CHECK ("loyalty_accounts"."rank_version" > 0),
	CONSTRAINT "loyalty_accounts_version_check" CHECK ("loyalty_accounts"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "loyalty_accounts_rank_code_idx" ON "loyalty_accounts" USING btree ("rank_code");
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loyalty_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"loyalty_account_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"entry_type" varchar(20) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(160) NOT NULL,
	"source_order_id" integer,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"xp_delta" integer NOT NULL,
	"coal_delta" integer NOT NULL,
	"xp_balance" integer NOT NULL,
	"coal_balance" integer NOT NULL,
	"source_order_total_minor" bigint,
	"source_order_currency" varchar(3),
	"reason" varchar(240) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "loyalty_ledger_source_rule_unique" UNIQUE("source_type", "source_id", "rule_version"),
	CONSTRAINT "loyalty_ledger_entry_type_check" CHECK ("loyalty_ledger"."entry_type" IN ('earned', 'spent', 'correction')),
	CONSTRAINT "loyalty_ledger_source_type_check" CHECK ("loyalty_ledger"."source_type" IN ('completed_order', 'redemption', 'admin_correction')),
	CONSTRAINT "loyalty_ledger_rule_version_check" CHECK ("loyalty_ledger"."rule_version" > 0),
	CONSTRAINT "loyalty_ledger_source_id_not_blank_check" CHECK (length(btrim("loyalty_ledger"."source_id")) > 0),
	CONSTRAINT "loyalty_ledger_idempotency_key_not_blank_check" CHECK (length(btrim("loyalty_ledger"."idempotency_key")) > 0),
	CONSTRAINT "loyalty_ledger_reason_not_blank_check" CHECK (length(btrim("loyalty_ledger"."reason")) > 0),
	CONSTRAINT "loyalty_ledger_actor_type_check" CHECK ("loyalty_ledger"."actor_type" IN ('system', 'customer', 'admin')),
	CONSTRAINT "loyalty_ledger_xp_delta_check" CHECK ("loyalty_ledger"."xp_delta" BETWEEN -2147483647 AND 2147483647),
	CONSTRAINT "loyalty_ledger_coal_delta_check" CHECK ("loyalty_ledger"."coal_delta" BETWEEN -2147483647 AND 2147483647),
	CONSTRAINT "loyalty_ledger_xp_balance_check" CHECK ("loyalty_ledger"."xp_balance" BETWEEN 0 AND 2147483647),
	CONSTRAINT "loyalty_ledger_coal_balance_check" CHECK ("loyalty_ledger"."coal_balance" BETWEEN 0 AND 2147483647),
	CONSTRAINT "loyalty_ledger_source_order_snapshot_check" CHECK (("loyalty_ledger"."source_type" = 'completed_order' AND "loyalty_ledger"."entry_type" = 'earned' AND "loyalty_ledger"."source_order_id" IS NOT NULL AND "loyalty_ledger"."source_order_total_minor" IS NOT NULL AND "loyalty_ledger"."source_order_currency" IS NOT NULL) OR ("loyalty_ledger"."source_type" <> 'completed_order' AND "loyalty_ledger"."source_order_id" IS NULL AND "loyalty_ledger"."source_order_total_minor" IS NULL AND "loyalty_ledger"."source_order_currency" IS NULL)),
	CONSTRAINT "loyalty_ledger_source_order_currency_check" CHECK ("loyalty_ledger"."source_order_currency" IS NULL OR "loyalty_ledger"."source_order_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "loyalty_ledger_source_order_total_check" CHECK ("loyalty_ledger"."source_order_total_minor" IS NULL OR "loyalty_ledger"."source_order_total_minor" >= 0),
	CONSTRAINT "loyalty_ledger_entry_semantics_check" CHECK (("loyalty_ledger"."entry_type" = 'earned' AND "loyalty_ledger"."source_type" = 'completed_order' AND "loyalty_ledger"."actor_type" = 'system' AND "loyalty_ledger"."xp_delta" >= 0 AND "loyalty_ledger"."coal_delta" >= 0) OR ("loyalty_ledger"."entry_type" = 'spent' AND "loyalty_ledger"."source_type" = 'redemption' AND "loyalty_ledger"."actor_type" = 'customer' AND "loyalty_ledger"."xp_delta" = 0 AND "loyalty_ledger"."coal_delta" < 0) OR ("loyalty_ledger"."entry_type" = 'correction' AND "loyalty_ledger"."source_type" = 'admin_correction' AND "loyalty_ledger"."actor_type" = 'admin' AND ("loyalty_ledger"."xp_delta" <> 0 OR "loyalty_ledger"."coal_delta" <> 0)))
);
--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_loyalty_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("loyalty_account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_created_at_idx" ON "loyalty_ledger" USING btree ("customer_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "loyalty_ledger_source_order_id_idx" ON "loyalty_ledger" USING btree ("source_order_id");
--> statement-breakpoint
CREATE TABLE "loyalty_rank_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loyalty_rank_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"loyalty_account_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"old_rank_code" varchar(32),
	"new_rank_code" varchar(32) NOT NULL,
	"xp_snapshot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_rank_history_old_rank_check" CHECK ("loyalty_rank_history"."old_rank_code" IS NULL OR "loyalty_rank_history"."old_rank_code" IN ('spark', 'heat', 'flame', 'volcano')),
	CONSTRAINT "loyalty_rank_history_new_rank_check" CHECK ("loyalty_rank_history"."new_rank_code" IN ('spark', 'heat', 'flame', 'volcano')),
	CONSTRAINT "loyalty_rank_history_different_rank_check" CHECK ("loyalty_rank_history"."old_rank_code" IS NULL OR "loyalty_rank_history"."old_rank_code" <> "loyalty_rank_history"."new_rank_code"),
	CONSTRAINT "loyalty_rank_history_xp_snapshot_check" CHECK ("loyalty_rank_history"."xp_snapshot" BETWEEN 0 AND 2147483647)
);
--> statement-breakpoint
ALTER TABLE "loyalty_rank_history" ADD CONSTRAINT "loyalty_rank_history_loyalty_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("loyalty_account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "loyalty_rank_history" ADD CONSTRAINT "loyalty_rank_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "loyalty_rank_history_customer_created_at_idx" ON "loyalty_rank_history" USING btree ("customer_id", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "loyalty_rewards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loyalty_rewards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" varchar(2048) DEFAULT '' NOT NULL,
	"cost_coal" integer NOT NULL,
	"is_visible" boolean DEFAULT false NOT NULL,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_rewards_code_unique" UNIQUE("code"),
	CONSTRAINT "loyalty_rewards_code_format_check" CHECK ("loyalty_rewards"."code" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
	CONSTRAINT "loyalty_rewards_name_not_blank_check" CHECK (length(btrim("loyalty_rewards"."name")) > 0),
	CONSTRAINT "loyalty_rewards_cost_check" CHECK ("loyalty_rewards"."cost_coal" BETWEEN 1 AND 2147483647),
	CONSTRAINT "loyalty_rewards_sort_order_check" CHECK ("loyalty_rewards"."sort_order" >= 0),
	CONSTRAINT "loyalty_rewards_version_check" CHECK ("loyalty_rewards"."version" > 0),
	CONSTRAINT "loyalty_rewards_active_period_check" CHECK ("loyalty_rewards"."active_until" IS NULL OR "loyalty_rewards"."active_from" IS NULL OR "loyalty_rewards"."active_until" > "loyalty_rewards"."active_from")
);
--> statement-breakpoint
CREATE INDEX "loyalty_rewards_visibility_sort_idx" ON "loyalty_rewards" USING btree ("is_visible", "sort_order", "id");
--> statement-breakpoint
CREATE TABLE "loyalty_redemptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loyalty_redemptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"loyalty_account_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"reward_id" integer NOT NULL,
	"reward_code" varchar(80) NOT NULL,
	"reward_name" varchar(160) NOT NULL,
	"cost_coal" integer NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "loyalty_redemptions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "loyalty_redemptions_reward_code_not_blank_check" CHECK (length(btrim("loyalty_redemptions"."reward_code")) > 0),
	CONSTRAINT "loyalty_redemptions_reward_name_not_blank_check" CHECK (length(btrim("loyalty_redemptions"."reward_name")) > 0),
	CONSTRAINT "loyalty_redemptions_cost_check" CHECK ("loyalty_redemptions"."cost_coal" BETWEEN 1 AND 2147483647),
	CONSTRAINT "loyalty_redemptions_idempotency_key_not_blank_check" CHECK (length(btrim("loyalty_redemptions"."idempotency_key")) > 0),
	CONSTRAINT "loyalty_redemptions_status_check" CHECK ("loyalty_redemptions"."status" IN ('pending', 'succeeded', 'canceled', 'reconciliation_required'))
);
--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_loyalty_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("loyalty_account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_reward_id_loyalty_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_rewards"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "loyalty_redemptions_customer_created_at_idx" ON "loyalty_redemptions" USING btree ("customer_id", "created_at", "id");
