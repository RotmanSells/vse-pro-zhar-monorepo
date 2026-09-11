ALTER TABLE "loyalty_ledger" DROP CONSTRAINT "loyalty_ledger_source_type_check";
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_source_type_check" CHECK ("loyalty_ledger"."source_type" IN ('completed_order', 'redemption', 'admin_correction', 'wheel_spin', 'quest_reward'));
ALTER TABLE "loyalty_ledger" DROP CONSTRAINT "loyalty_ledger_source_order_snapshot_check";
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_source_order_snapshot_check" CHECK (("loyalty_ledger"."source_type" IN ('completed_order', 'wheel_spin') AND "loyalty_ledger"."entry_type" = 'earned' AND "loyalty_ledger"."source_order_id" IS NOT NULL AND "loyalty_ledger"."source_order_total_minor" IS NOT NULL AND "loyalty_ledger"."source_order_currency" IS NOT NULL) OR ("loyalty_ledger"."source_type" IN ('redemption', 'admin_correction', 'quest_reward') AND "loyalty_ledger"."source_order_id" IS NULL AND "loyalty_ledger"."source_order_total_minor" IS NULL AND "loyalty_ledger"."source_order_currency" IS NULL));
ALTER TABLE "loyalty_ledger" DROP CONSTRAINT "loyalty_ledger_entry_semantics_check";
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_entry_semantics_check" CHECK (("loyalty_ledger"."entry_type" = 'earned' AND "loyalty_ledger"."source_type" IN ('completed_order', 'wheel_spin', 'quest_reward') AND "loyalty_ledger"."actor_type" = 'system' AND "loyalty_ledger"."xp_delta" >= 0 AND "loyalty_ledger"."coal_delta" >= 0) OR ("loyalty_ledger"."entry_type" = 'spent' AND "loyalty_ledger"."source_type" = 'redemption' AND "loyalty_ledger"."actor_type" = 'customer' AND "loyalty_ledger"."xp_delta" = 0 AND "loyalty_ledger"."coal_delta" < 0) OR ("loyalty_ledger"."entry_type" = 'correction' AND "loyalty_ledger"."source_type" = 'admin_correction' AND "loyalty_ledger"."actor_type" = 'admin' AND ("loyalty_ledger"."xp_delta" <> 0 OR "loyalty_ledger"."coal_delta" <> 0)));
--> statement-breakpoint
CREATE TABLE "wheel_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"enabled" boolean DEFAULT true NOT NULL,
	"eligibility" varchar(40) DEFAULT 'completed_paid_order' NOT NULL,
	"min_order_amount_minor" integer DEFAULT 150000 NOT NULL,
	"currency" varchar(3) DEFAULT 'RUB' NOT NULL,
	"cooldown_seconds" integer DEFAULT 86400 NOT NULL,
	"max_spins" integer DEFAULT 1 NOT NULL,
	"limit_period_seconds" integer DEFAULT 86400 NOT NULL,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheel_settings_singleton_check" CHECK ("wheel_settings"."id" = 1),
	CONSTRAINT "wheel_settings_eligibility_check" CHECK ("wheel_settings"."eligibility" = 'completed_paid_order'),
	CONSTRAINT "wheel_settings_min_order_check" CHECK ("wheel_settings"."min_order_amount_minor" = 150000),
	CONSTRAINT "wheel_settings_currency_check" CHECK ("wheel_settings"."currency" = 'RUB'),
	CONSTRAINT "wheel_settings_cooldown_check" CHECK ("wheel_settings"."cooldown_seconds" = 86400),
	CONSTRAINT "wheel_settings_max_spins_check" CHECK ("wheel_settings"."max_spins" = 1),
	CONSTRAINT "wheel_settings_period_check" CHECK ("wheel_settings"."limit_period_seconds" = 86400),
	CONSTRAINT "wheel_settings_version_check" CHECK ("wheel_settings"."version" > 0),
	CONSTRAINT "wheel_settings_active_period_check" CHECK ("wheel_settings"."active_until" IS NULL OR "wheel_settings"."active_from" IS NULL OR "wheel_settings"."active_until" > "wheel_settings"."active_from")
);
--> statement-breakpoint
CREATE TABLE "wheel_prizes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_prizes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" varchar(2048) DEFAULT '' NOT NULL,
	"prize_type" varchar(20) NOT NULL,
	"value" integer NOT NULL,
	"weight" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheel_prizes_code_unique" UNIQUE("code"),
	CONSTRAINT "wheel_prizes_code_format_check" CHECK ("wheel_prizes"."code" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
	CONSTRAINT "wheel_prizes_name_not_blank_check" CHECK (length(btrim("wheel_prizes"."name")) > 0),
	CONSTRAINT "wheel_prizes_type_check" CHECK ("wheel_prizes"."prize_type" IN ('no_prize', 'coal', 'xp')),
	CONSTRAINT "wheel_prizes_value_check" CHECK (("wheel_prizes"."prize_type" = 'no_prize' AND "wheel_prizes"."value" = 0) OR ("wheel_prizes"."prize_type" IN ('coal', 'xp') AND "wheel_prizes"."value" > 0)),
	CONSTRAINT "wheel_prizes_weight_check" CHECK ("wheel_prizes"."weight" BETWEEN 0 AND 2147483647),
	CONSTRAINT "wheel_prizes_sort_order_check" CHECK ("wheel_prizes"."sort_order" >= 0),
	CONSTRAINT "wheel_prizes_version_check" CHECK ("wheel_prizes"."version" > 0),
	CONSTRAINT "wheel_prizes_active_period_check" CHECK ("wheel_prizes"."active_until" IS NULL OR "wheel_prizes"."active_from" IS NULL OR "wheel_prizes"."active_until" > "wheel_prizes"."active_from")
);
--> statement-breakpoint
CREATE INDEX "wheel_prizes_visibility_sort_idx" ON "wheel_prizes" USING btree ("is_visible", "sort_order", "id");
--> statement-breakpoint
CREATE TABLE "wheel_spins" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_spins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"source_order_id" integer NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"prize_id" integer NOT NULL,
	"prize_code" varchar(80) NOT NULL,
	"prize_name" varchar(160) NOT NULL,
	"prize_type" varchar(20) NOT NULL,
	"prize_value" integer NOT NULL,
	"prize_weight" integer NOT NULL,
	"prize_sort_order" integer NOT NULL,
	"status" varchar(32) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheel_spins_source_order_id_unique" UNIQUE("source_order_id"),
	CONSTRAINT "wheel_spins_customer_id_idempotency_unique" UNIQUE("customer_id", "idempotency_key"),
	CONSTRAINT "wheel_spins_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_spins_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_spins_prize_id_wheel_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."wheel_prizes"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_spins_idempotency_not_blank_check" CHECK (length(btrim("wheel_spins"."idempotency_key")) > 0),
	CONSTRAINT "wheel_spins_prize_type_check" CHECK ("wheel_spins"."prize_type" IN ('no_prize', 'coal', 'xp')),
	CONSTRAINT "wheel_spins_prize_value_check" CHECK (("wheel_spins"."prize_type" = 'no_prize' AND "wheel_spins"."prize_value" = 0) OR ("wheel_spins"."prize_type" IN ('coal', 'xp') AND "wheel_spins"."prize_value" > 0)),
	CONSTRAINT "wheel_spins_prize_weight_check" CHECK ("wheel_spins"."prize_weight" >= 0),
	CONSTRAINT "wheel_spins_prize_sort_order_check" CHECK ("wheel_spins"."prize_sort_order" >= 0),
	CONSTRAINT "wheel_spins_status_check" CHECK ("wheel_spins"."status" = 'completed')
);
--> statement-breakpoint
CREATE INDEX "wheel_spins_customer_created_at_idx" ON "wheel_spins" USING btree ("customer_id", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "wheel_reward_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_reward_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spin_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"reward_type" varchar(20) NOT NULL,
	"reward_value" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheel_reward_claims_spin_id_unique" UNIQUE("spin_id"),
	CONSTRAINT "wheel_reward_claims_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "wheel_reward_claims_spin_id_wheel_spins_id_fk" FOREIGN KEY ("spin_id") REFERENCES "public"."wheel_spins"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_reward_claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_reward_claims_type_check" CHECK ("wheel_reward_claims"."reward_type" IN ('no_prize', 'coal', 'xp')),
	CONSTRAINT "wheel_reward_claims_value_check" CHECK (("wheel_reward_claims"."reward_type" = 'no_prize' AND "wheel_reward_claims"."reward_value" = 0) OR ("wheel_reward_claims"."reward_type" IN ('coal', 'xp') AND "wheel_reward_claims"."reward_value" > 0)),
	CONSTRAINT "wheel_reward_claims_status_check" CHECK ("wheel_reward_claims"."status" IN ('not_applicable', 'succeeded', 'reconciliation_required')),
	CONSTRAINT "wheel_reward_claims_idempotency_not_blank_check" CHECK (length(btrim("wheel_reward_claims"."idempotency_key")) > 0)
 );
--> statement-breakpoint
CREATE TABLE "quest_definitions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quest_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(80) NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" varchar(2048) DEFAULT '' NOT NULL,
	"goal" integer NOT NULL,
	"unit" varchar(20) NOT NULL,
	"reward_type" varchar(20) NOT NULL,
	"reward_value" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_definitions_code_unique" UNIQUE("code"),
	CONSTRAINT "quest_definitions_code_format_check" CHECK ("quest_definitions"."code" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
	CONSTRAINT "quest_definitions_title_not_blank_check" CHECK (length(btrim("quest_definitions"."title")) > 0),
	CONSTRAINT "quest_definitions_goal_check" CHECK ("quest_definitions"."goal" BETWEEN 1 AND 2147483647),
	CONSTRAINT "quest_definitions_unit_check" CHECK ("quest_definitions"."unit" IN ('order', 'minor_units')),
	CONSTRAINT "quest_definitions_reward_type_check" CHECK ("quest_definitions"."reward_type" IN ('xp', 'coal')),
	CONSTRAINT "quest_definitions_reward_value_check" CHECK ("quest_definitions"."reward_value" BETWEEN 1 AND 2147483647),
	CONSTRAINT "quest_definitions_sort_order_check" CHECK ("quest_definitions"."sort_order" >= 0),
	CONSTRAINT "quest_definitions_version_check" CHECK ("quest_definitions"."version" > 0),
	CONSTRAINT "quest_definitions_active_period_check" CHECK ("quest_definitions"."active_until" IS NULL OR "quest_definitions"."active_from" IS NULL OR "quest_definitions"."active_until" > "quest_definitions"."active_from")
 );
--> statement-breakpoint
CREATE INDEX "quest_definitions_visibility_sort_idx" ON "quest_definitions" USING btree ("is_visible", "sort_order", "id");
--> statement-breakpoint
CREATE TABLE "quest_progress" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quest_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"quest_definition_id" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "quest_progress_customer_definition_unique" UNIQUE("customer_id", "quest_definition_id"),
	CONSTRAINT "quest_progress_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_progress_quest_definition_id_quest_definitions_id_fk" FOREIGN KEY ("quest_definition_id") REFERENCES "public"."quest_definitions"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_progress_value_check" CHECK ("quest_progress"."progress" >= 0),
	CONSTRAINT "quest_progress_status_check" CHECK ("quest_progress"."status" IN ('active', 'earned'))
 );
--> statement-breakpoint
CREATE TABLE "quest_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quest_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"quest_definition_id" integer NOT NULL,
	"source_order_id" integer NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"delta" integer NOT NULL,
	"progress_before" integer NOT NULL,
	"progress_after" integer NOT NULL,
	"source_order_total_minor" bigint NOT NULL,
	"source_order_currency" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_events_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "quest_events_definition_order_unique" UNIQUE("quest_definition_id", "source_order_id"),
	CONSTRAINT "quest_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_events_quest_definition_id_quest_definitions_id_fk" FOREIGN KEY ("quest_definition_id") REFERENCES "public"."quest_definitions"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_events_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_events_key_not_blank_check" CHECK (length(btrim("quest_events"."event_key")) > 0),
	CONSTRAINT "quest_events_delta_check" CHECK ("quest_events"."delta" > 0),
	CONSTRAINT "quest_events_progress_check" CHECK ("quest_events"."progress_before" >= 0 AND "quest_events"."progress_after" >= "quest_events"."progress_before"),
	CONSTRAINT "quest_events_currency_check" CHECK ("quest_events"."source_order_currency" = 'RUB'),
	CONSTRAINT "quest_events_total_check" CHECK ("quest_events"."source_order_total_minor" >= 0)
 );
--> statement-breakpoint
CREATE INDEX "quest_events_customer_created_at_idx" ON "quest_events" USING btree ("customer_id", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "quest_reward_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quest_reward_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"quest_definition_id" integer NOT NULL,
	"reward_type" varchar(20) NOT NULL,
	"reward_value" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "quest_reward_claims_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "quest_reward_claims_customer_definition_unique" UNIQUE("customer_id", "quest_definition_id"),
	CONSTRAINT "quest_reward_claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_reward_claims_quest_definition_id_quest_definitions_id_fk" FOREIGN KEY ("quest_definition_id") REFERENCES "public"."quest_definitions"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "quest_reward_claims_type_check" CHECK ("quest_reward_claims"."reward_type" IN ('xp', 'coal')),
	CONSTRAINT "quest_reward_claims_value_check" CHECK ("quest_reward_claims"."reward_value" BETWEEN 1 AND 2147483647),
	CONSTRAINT "quest_reward_claims_status_check" CHECK ("quest_reward_claims"."status" IN ('pending', 'succeeded', 'reconciliation_required')),
	CONSTRAINT "quest_reward_claims_idempotency_not_blank_check" CHECK (length(btrim("quest_reward_claims"."idempotency_key")) > 0)
 );
--> statement-breakpoint
INSERT INTO "wheel_settings" ("enabled", "eligibility", "min_order_amount_minor", "currency", "cooldown_seconds", "max_spins", "limit_period_seconds", "active_from", "version") VALUES (true, 'completed_paid_order', 150000, 'RUB', 86400, 1, 86400, now(), 1);
INSERT INTO "wheel_prizes" ("code", "name", "description", "prize_type", "value", "weight", "is_visible", "active_from", "sort_order", "version") VALUES
 ('no_prize', 'Искра рядом', 'В этот раз без награды — следующая попытка будет доступна после нового заказа.', 'no_prize', 0, 50, true, now(), 0, 1),
 ('coal_10', '+10 Угольков', 'Угольки начислены на баланс.', 'coal', 10, 25, true, now(), 1, 1),
 ('coal_25', '+25 Угольков', 'Угольки начислены на баланс.', 'coal', 25, 15, true, now(), 2, 1),
 ('xp_100', '+100 XP', 'XP начислены в Паспорт.', 'xp', 100, 10, true, now(), 3, 1);
INSERT INTO "quest_definitions" ("code", "title", "description", "goal", "unit", "reward_type", "reward_value", "is_visible", "active_from", "sort_order", "version") VALUES
 ('first_order', 'Первый жар', 'Завершите первый оплаченный заказ.', 1, 'order', 'xp', 100, true, now(), 0, 1),
 ('regular_guest', 'Постоянный гость', 'Завершите три оплаченных заказа.', 3, 'order', 'coal', 30, true, now(), 1, 1),
 ('warming_up', 'Разогрев', 'Наберите 3 000 ₽ в завершённых оплаченных заказах.', 300000, 'minor_units', 'xp', 150, true, now(), 2, 1);
