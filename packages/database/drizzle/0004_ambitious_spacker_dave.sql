CREATE TABLE "iiko_order_dispatches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iiko_order_dispatches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"correlation_id" varchar(160) NOT NULL,
	"provider_order_id" varchar(160),
	"command_id" varchar(160),
	"status" varchar(32) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iiko_order_dispatches_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "iiko_order_dispatches_correlation_id_unique" UNIQUE("correlation_id"),
	CONSTRAINT "iiko_order_dispatches_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "iiko_order_dispatches_status_check" CHECK ("iiko_order_dispatches"."status" IN ('pending', 'creating', 'command_pending', 'submitted', 'failed')),
	CONSTRAINT "iiko_order_dispatches_attempt_count_check" CHECK ("iiko_order_dispatches"."attempt_count" >= 0),
	CONSTRAINT "iiko_order_dispatches_correlation_id_not_blank_check" CHECK (length(btrim("iiko_order_dispatches"."correlation_id")) > 0),
	CONSTRAINT "iiko_order_dispatches_error_code_not_blank_check" CHECK ("iiko_order_dispatches"."last_error_code" IS NULL OR length(btrim("iiko_order_dispatches"."last_error_code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "order_iiko_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_iiko_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"order_item_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"iiko_product_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_iiko_items_order_item_id_unique" UNIQUE("order_item_id"),
	CONSTRAINT "order_iiko_items_order_id_product_id_unique" UNIQUE("order_id","product_id"),
	CONSTRAINT "order_iiko_items_product_id_check" CHECK ("order_iiko_items"."product_id" > 0),
	CONSTRAINT "order_iiko_items_mapping_not_blank_check" CHECK ("order_iiko_items"."iiko_product_id" IS NULL OR length(btrim("order_iiko_items"."iiko_product_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_status_history" DROP CONSTRAINT "order_status_history_status_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "iiko_order_dispatches" ADD CONSTRAINT "iiko_order_dispatches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_iiko_items" ADD CONSTRAINT "order_iiko_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_iiko_items" ADD CONSTRAINT "order_iiko_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "iiko_order_dispatches_due_idx" ON "iiko_order_dispatches" USING btree ("status","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "order_iiko_items_order_id_idx" ON "order_iiko_items" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_status_unique" UNIQUE("order_id","status");--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_status_check" CHECK ("order_status_history"."status" IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem'));