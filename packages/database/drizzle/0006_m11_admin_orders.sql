CREATE TABLE "staff_users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"login" varchar(80) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(16) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_login_unique" UNIQUE("login"),
	CONSTRAINT "staff_users_login_format_check" CHECK ("staff_users"."login" ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
	CONSTRAINT "staff_users_display_name_not_blank_check" CHECK (length(btrim("staff_users"."display_name")) > 0),
	CONSTRAINT "staff_users_password_hash_not_blank_check" CHECK (length(btrim("staff_users"."password_hash")) > 0),
	CONSTRAINT "staff_users_role_check" CHECK ("staff_users"."role" IN ('admin', 'operator'))
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_user_id" integer,
	"action" varchar(64) NOT NULL,
	"order_id" integer,
	"request_id" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_audit_log_action_check" CHECK ("staff_audit_log"."action" IN ('staff_login', 'staff_logout', 'order_fulfillment_retry')),
	CONSTRAINT "staff_audit_log_order_action_check" CHECK ("staff_audit_log"."action" <> 'order_fulfillment_retry' OR "staff_audit_log"."order_id" IS NOT NULL),
	CONSTRAINT "staff_audit_log_request_id_check" CHECK ("staff_audit_log"."request_id" IS NULL OR length(btrim("staff_audit_log"."request_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "staff_audit_log" ADD CONSTRAINT "staff_audit_log_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_user_id_idx" ON "staff_sessions" USING btree ("staff_user_id");
--> statement-breakpoint
CREATE INDEX "staff_sessions_expires_at_idx" ON "staff_sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "staff_audit_log_staff_user_id_created_at_idx" ON "staff_audit_log" USING btree ("staff_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "staff_audit_log_order_id_created_at_idx" ON "staff_audit_log" USING btree ("order_id", "created_at");
--> statement-breakpoint
CREATE INDEX "staff_audit_log_created_at_idx" ON "staff_audit_log" USING btree ("created_at");
