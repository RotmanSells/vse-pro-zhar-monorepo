ALTER TABLE "iiko_order_dispatches" DROP CONSTRAINT "iiko_order_dispatches_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "iiko_order_dispatches" ADD CONSTRAINT "iiko_order_dispatches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE cascade;