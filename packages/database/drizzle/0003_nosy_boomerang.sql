CREATE TABLE "payment_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" varchar(32) NOT NULL,
	"provider_payment_id" varchar(160) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"event_fingerprint" varchar(64) NOT NULL,
	"provider_status" varchar(32) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_fingerprint_unique" UNIQUE("provider","event_fingerprint"),
	CONSTRAINT "payment_events_provider_check" CHECK ("payment_events"."provider" = 'yookassa'),
	CONSTRAINT "payment_events_provider_payment_id_not_blank_check" CHECK (length(btrim("payment_events"."provider_payment_id")) > 0),
	CONSTRAINT "payment_events_event_type_not_blank_check" CHECK (length(btrim("payment_events"."event_type")) > 0),
	CONSTRAINT "payment_events_event_fingerprint_check" CHECK ("payment_events"."event_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_events_provider_status_check" CHECK ("payment_events"."provider_status" IN ('pending', 'waiting_for_capture', 'succeeded', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_payment_id" varchar(160) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) NOT NULL,
	"provider_status" varchar(32) NOT NULL,
	"confirmation_type" varchar(32),
	"confirmation_url" text,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_customer_id_idempotency_key_unique" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" = 'yookassa'),
	CONSTRAINT "payments_provider_payment_id_not_blank_check" CHECK (length(btrim("payments"."provider_payment_id")) > 0),
	CONSTRAINT "payments_amount_minor_check" CHECK ("payments"."amount_minor" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'succeeded', 'canceled')),
	CONSTRAINT "payments_provider_status_check" CHECK ("payments"."provider_status" IN ('pending', 'waiting_for_capture', 'succeeded', 'canceled')),
	CONSTRAINT "payments_confirmation_check" CHECK (("payments"."confirmation_type" IS NULL AND "payments"."confirmation_url" IS NULL) OR ("payments"."confirmation_type" = 'redirect' AND length(btrim("payments"."confirmation_url")) > 0)),
	CONSTRAINT "payments_idempotency_key_not_blank_check" CHECK (length(btrim("payments"."idempotency_key")) > 0),
	CONSTRAINT "payments_payload_fingerprint_check" CHECK ("payments"."payload_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "order_status_history" DROP CONSTRAINT "order_status_history_status_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "payment_events_provider_payment_id_idx" ON "payment_events" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_active_unique" ON "payments" USING btree ("order_id") WHERE "payments"."status" IN ('pending', 'succeeded');--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_customer_id_created_at_idx" ON "payments" USING btree ("customer_id","created_at");--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_status_check" CHECK ("order_status_history"."status" IN ('pending_payment', 'payment_confirmed'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending_payment', 'payment_confirmed'));