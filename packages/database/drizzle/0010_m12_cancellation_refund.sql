ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem', 'canceled'));
--> statement-breakpoint
ALTER TABLE "order_status_history" DROP CONSTRAINT "order_status_history_status_check";
--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_status_check" CHECK ("order_status_history"."status" IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem', 'canceled'));
--> statement-breakpoint
ALTER TABLE "staff_audit_log" DROP CONSTRAINT "staff_audit_log_action_check";
--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_action_check" CHECK ("staff_audit_log"."action" IN ('staff_login', 'staff_logout', 'order_fulfillment_retry', 'order_cancel', 'refund_reconcile'));
--> statement-breakpoint
CREATE TABLE "order_cancellations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_cancellations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"customer_id" integer,
	"staff_user_id" integer,
	"actor_type" varchar(16) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_cancellations_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "order_cancellations_order_idempotency_key_unique" UNIQUE("order_id", "idempotency_key"),
	CONSTRAINT "order_cancellations_actor_check" CHECK (("order_cancellations"."actor_type" = 'customer' AND "order_cancellations"."customer_id" IS NOT NULL AND "order_cancellations"."staff_user_id" IS NULL) OR ("order_cancellations"."actor_type" = 'admin' AND "order_cancellations"."customer_id" IS NULL AND "order_cancellations"."staff_user_id" IS NOT NULL)),
	CONSTRAINT "order_cancellations_actor_type_check" CHECK ("order_cancellations"."actor_type" IN ('customer', 'admin')),
	CONSTRAINT "order_cancellations_reason_code_check" CHECK ("order_cancellations"."reason_code" IN ('customer_requested', 'admin_requested')),
	CONSTRAINT "order_cancellations_idempotency_key_not_blank_check" CHECK (length(btrim("order_cancellations"."idempotency_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_refund_id" varchar(160),
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(32) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error_code" varchar(80),
	"last_attempt_at" timestamp with time zone,
	"last_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "refunds_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_provider_check" CHECK ("refunds"."provider" = 'yookassa'),
	CONSTRAINT "refunds_amount_minor_check" CHECK ("refunds"."amount_minor" >= 0),
	CONSTRAINT "refunds_currency_check" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" IN ('pending', 'succeeded', 'canceled', 'reconciliation_required')),
	CONSTRAINT "refunds_attempt_count_check" CHECK ("refunds"."attempt_count" >= 0),
	CONSTRAINT "refunds_idempotency_key_not_blank_check" CHECK (length(btrim("refunds"."idempotency_key")) > 0),
	CONSTRAINT "refunds_provider_refund_id_not_blank_check" CHECK ("refunds"."provider_refund_id" IS NULL OR length(btrim("refunds"."provider_refund_id")) > 0),
	CONSTRAINT "refunds_error_code_not_blank_check" CHECK ("refunds"."last_error_code" IS NULL OR length(btrim("refunds"."last_error_code")) > 0)
 );
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "refunds_due_idx" ON "refunds" USING btree ("status", "next_attempt_at", "id");
--> statement-breakpoint
CREATE INDEX "refunds_order_id_idx" ON "refunds" USING btree ("order_id");
--> statement-breakpoint
CREATE TABLE "refund_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refund_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" varchar(32) NOT NULL,
	"provider_refund_id" varchar(160) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"event_fingerprint" varchar(64) NOT NULL,
	"provider_status" varchar(32) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_events_provider_fingerprint_unique" UNIQUE("provider", "event_fingerprint"),
	CONSTRAINT "refund_events_provider_check" CHECK ("refund_events"."provider" = 'yookassa'),
	CONSTRAINT "refund_events_provider_refund_id_not_blank_check" CHECK (length(btrim("refund_events"."provider_refund_id")) > 0),
	CONSTRAINT "refund_events_event_type_not_blank_check" CHECK (length(btrim("refund_events"."event_type")) > 0),
	CONSTRAINT "refund_events_event_fingerprint_check" CHECK ("refund_events"."event_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refund_events_provider_status_check" CHECK ("refund_events"."provider_status" IN ('pending', 'succeeded', 'canceled'))
 );
--> statement-breakpoint
CREATE INDEX "refund_events_provider_refund_id_idx" ON "refund_events" USING btree ("provider", "provider_refund_id");
