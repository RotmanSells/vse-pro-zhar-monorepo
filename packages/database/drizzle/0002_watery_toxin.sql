CREATE TABLE "order_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "order_items_product_id_check" CHECK ("order_items"."product_id" > 0),
	CONSTRAINT "order_items_product_name_not_blank_check" CHECK (length(btrim("order_items"."product_name")) > 0),
	CONSTRAINT "order_items_unit_price_minor_check" CHECK ("order_items"."unit_price_minor" >= 0),
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "order_items_line_total_minor_check" CHECK ("order_items"."line_total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_history_status_check" CHECK ("order_status_history"."status" IN ('pending_payment'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"customer_id" integer NOT NULL,
	"pickup_location_id" varchar(160) NOT NULL,
	"pickup_location_name" varchar(240) NOT NULL,
	"pickup_location_address" varchar(240) NOT NULL,
	"pickup_location_timezone" varchar(80) NOT NULL,
	"pickup_slot_id" varchar(160) NOT NULL,
	"pickup_slot_label" varchar(240) NOT NULL,
	"pickup_slot_starts_at" timestamp with time zone NOT NULL,
	"pickup_slot_ends_at" timestamp with time zone NOT NULL,
	"status" varchar(32) NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_customer_id_idempotency_key_unique" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending_payment')),
	CONSTRAINT "orders_total_minor_check" CHECK ("orders"."total_minor" >= 0),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_idempotency_key_not_blank_check" CHECK (length(btrim("orders"."idempotency_key")) > 0),
	CONSTRAINT "orders_payload_fingerprint_check" CHECK ("orders"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orders_pickup_slot_range_check" CHECK ("orders"."pickup_slot_ends_at" > "orders"."pickup_slot_starts_at")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders" USING btree ("customer_id","created_at");