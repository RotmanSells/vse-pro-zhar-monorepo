CREATE TABLE IF NOT EXISTS "customer_notification_deliveries" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"provider" varchar(16) DEFAULT 'expo' NOT NULL,
	"request_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"provider_ticket_id" varchar(128),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notification_deliveries_request_device_unique" UNIQUE("request_key","device_id"),
	CONSTRAINT "customer_notification_deliveries_provider_ticket_unique" UNIQUE("provider","provider_ticket_id"),
	CONSTRAINT "customer_notification_deliveries_provider_check" CHECK ("provider" = 'expo'),
	CONSTRAINT "customer_notification_deliveries_status_check" CHECK ("status" IN ('pending', 'accepted', 'delivered', 'failed', 'reconciliation_required')),
	CONSTRAINT "customer_notification_deliveries_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "customer_notification_deliveries" ADD CONSTRAINT "customer_notification_deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "customer_notification_deliveries" ADD CONSTRAINT "customer_notification_deliveries_device_id_customer_notification_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."customer_notification_devices"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_notification_deliveries_customer_id_idx" ON "customer_notification_deliveries" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_notification_deliveries_request_key_idx" ON "customer_notification_deliveries" USING btree ("request_key");
