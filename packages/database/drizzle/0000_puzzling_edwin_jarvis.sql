CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_slug_format_check" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "categories_name_not_blank_check" CHECK (length(btrim("categories"."name")) > 0),
	CONSTRAINT "categories_sort_order_check" CHECK ("categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_minor" integer NOT NULL,
	"image_url" text,
	"emoji" varchar(32) DEFAULT '🍽️' NOT NULL,
	"tag" varchar(16),
	"is_visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_not_blank_check" CHECK (length(btrim("products"."name")) > 0),
	CONSTRAINT "products_price_minor_check" CHECK ("products"."price_minor" >= 0),
	CONSTRAINT "products_sort_order_check" CHECK ("products"."sort_order" >= 0),
	CONSTRAINT "products_tag_check" CHECK ("products"."tag" IS NULL OR "products"."tag" IN ('hit', 'new'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
INSERT INTO "categories" ("slug", "name", "sort_order", "is_visible")
VALUES
	('shashlyk', 'Шашлык', 10, true),
	('krylya', 'Крылья', 20, true),
	('kebab', 'Кебаб', 30, true),
	('salaty', 'Салаты', 40, true),
	('garniry', 'Гарниры', 50, true),
	('deserty', 'Десерты', 60, true),
	('napitki', 'Напитки', 70, true)
ON CONFLICT ("slug") DO NOTHING;
