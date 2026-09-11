ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "customer_notification_devices" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"token" varchar(512) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notification_devices_provider_token_unique" UNIQUE("provider","token"),
	CONSTRAINT "customer_notification_devices_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "customer_notification_devices_provider_check" CHECK ("provider" = 'expo'),
	CONSTRAINT "customer_notification_devices_platform_check" CHECK ("platform" IN ('ios', 'android')),
	CONSTRAINT "customer_notification_devices_token_not_blank_check" CHECK (length(btrim("token")) > 0),
	CONSTRAINT "customer_notification_devices_idempotency_not_blank_check" CHECK (length(btrim("idempotency_key")) > 0),
	CONSTRAINT "customer_notification_devices_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "customer_notification_devices" ADD CONSTRAINT "customer_notification_devices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_notification_devices_customer_id_idx" ON "customer_notification_devices" USING btree ("customer_id");

CREATE TABLE IF NOT EXISTS "customer_notification_preferences" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL UNIQUE,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_notification_preferences" ADD CONSTRAINT "customer_notification_preferences_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_notification_preferences_customer_id_idx" ON "customer_notification_preferences" USING btree ("customer_id");

CREATE TABLE IF NOT EXISTS "sms_auth_challenges" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"phone" varchar(16) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_auth_challenges_phone_format_check" CHECK ("phone" ~ '^\\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "sms_auth_challenges_purpose_check" CHECK ("purpose" = 'login'),
	CONSTRAINT "sms_auth_challenges_code_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sms_auth_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_auth_challenges_phone_created_at_idx" ON "sms_auth_challenges" USING btree ("phone", "created_at");
