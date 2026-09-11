CREATE TABLE "order_customer_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_customer_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"phone" varchar(16) NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_customer_snapshots_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "order_customer_snapshots_phone_format_check" CHECK ("order_customer_snapshots"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "order_customer_snapshots_name_not_blank_check" CHECK (length(btrim("order_customer_snapshots"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_customer_snapshots" ADD CONSTRAINT "order_customer_snapshots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "order_customer_snapshots" ADD CONSTRAINT "order_customer_snapshots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "order_customer_snapshots_customer_id_idx" ON "order_customer_snapshots" USING btree ("customer_id");
--> statement-breakpoint
INSERT INTO "order_customer_snapshots" ("order_id", "customer_id", "phone", "name", "created_at")
SELECT o."id", o."customer_id", c."phone", c."name", o."created_at"
FROM "orders" o
INNER JOIN "customers" c ON c."id" = o."customer_id";
