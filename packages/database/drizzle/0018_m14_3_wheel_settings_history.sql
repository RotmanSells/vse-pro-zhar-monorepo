ALTER TABLE "wheel_settings" DROP CONSTRAINT "wheel_settings_min_order_check";
ALTER TABLE "wheel_settings" ADD CONSTRAINT "wheel_settings_min_order_check" CHECK ("wheel_settings"."min_order_amount_minor" BETWEEN 0 AND 2147483647);
ALTER TABLE "wheel_settings" DROP CONSTRAINT "wheel_settings_cooldown_check";
ALTER TABLE "wheel_settings" ADD CONSTRAINT "wheel_settings_cooldown_check" CHECK ("wheel_settings"."cooldown_seconds" BETWEEN 1 AND 2147483647);
ALTER TABLE "wheel_settings" DROP CONSTRAINT "wheel_settings_max_spins_check";
ALTER TABLE "wheel_settings" ADD CONSTRAINT "wheel_settings_max_spins_check" CHECK ("wheel_settings"."max_spins" BETWEEN 1 AND 2147483647);
ALTER TABLE "wheel_settings" DROP CONSTRAINT "wheel_settings_period_check";
ALTER TABLE "wheel_settings" ADD CONSTRAINT "wheel_settings_period_check" CHECK ("wheel_settings"."limit_period_seconds" BETWEEN 1 AND 2147483647);
--> statement-breakpoint
CREATE TABLE "wheel_settings_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wheel_settings_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wheel_settings_id" integer NOT NULL,
	"version" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"enabled" boolean NOT NULL,
	"eligibility" varchar(40) NOT NULL,
	"min_order_amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cooldown_seconds" integer NOT NULL,
	"max_spins" integer NOT NULL,
	"limit_period_seconds" integer NOT NULL,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"actor_staff_user_id" integer NOT NULL,
	"request_id" varchar(160) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wheel_settings_versions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "wheel_settings_versions_wheel_settings_id_fk" FOREIGN KEY ("wheel_settings_id") REFERENCES "public"."wheel_settings"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_settings_versions_actor_staff_user_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade,
	CONSTRAINT "wheel_settings_versions_settings_version_unique" UNIQUE("wheel_settings_id", "version"),
	CONSTRAINT "wheel_settings_versions_action_check" CHECK ("wheel_settings_versions"."action" = 'updated'),
	CONSTRAINT "wheel_settings_versions_eligibility_check" CHECK ("wheel_settings_versions"."eligibility" = 'completed_paid_order'),
	CONSTRAINT "wheel_settings_versions_min_order_check" CHECK ("wheel_settings_versions"."min_order_amount_minor" BETWEEN 0 AND 2147483647),
	CONSTRAINT "wheel_settings_versions_currency_check" CHECK ("wheel_settings_versions"."currency" = 'RUB'),
	CONSTRAINT "wheel_settings_versions_cooldown_check" CHECK ("wheel_settings_versions"."cooldown_seconds" BETWEEN 1 AND 2147483647),
	CONSTRAINT "wheel_settings_versions_max_spins_check" CHECK ("wheel_settings_versions"."max_spins" BETWEEN 1 AND 2147483647),
	CONSTRAINT "wheel_settings_versions_period_check" CHECK ("wheel_settings_versions"."limit_period_seconds" BETWEEN 1 AND 2147483647),
	CONSTRAINT "wheel_settings_versions_version_check" CHECK ("wheel_settings_versions"."version" > 0),
	CONSTRAINT "wheel_settings_versions_request_id_check" CHECK (length(btrim("wheel_settings_versions"."request_id")) > 0),
	CONSTRAINT "wheel_settings_versions_fingerprint_check" CHECK ("wheel_settings_versions"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wheel_settings_versions_active_period_check" CHECK ("wheel_settings_versions"."active_until" IS NULL OR "wheel_settings_versions"."active_from" IS NULL OR "wheel_settings_versions"."active_until" > "wheel_settings_versions"."active_from")
);
--> statement-breakpoint
CREATE INDEX "wheel_settings_versions_created_at_idx" ON "wheel_settings_versions" USING btree ("created_at");
