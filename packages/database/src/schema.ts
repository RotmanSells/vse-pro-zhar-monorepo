import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      "categories_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`
    ),
    check(
      "categories_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`
    ),
    check("categories_sort_order_check", sql`${table.sortOrder} >= 0`)
  ]
);

export const products = pgTable(
  "products",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    priceMinor: integer("price_minor").notNull(),
    imageUrl: text("image_url"),
    emoji: varchar("emoji", { length: 32 }).notNull().default("🍽️"),
    tag: varchar("tag", { length: 16 }),
    isVisible: boolean("is_visible").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      "products_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`
    ),
    check("products_price_minor_check", sql`${table.priceMinor} >= 0`),
    check("products_sort_order_check", sql`${table.sortOrder} >= 0`),
    check(
      "products_tag_check",
      sql`${table.tag} IS NULL OR ${table.tag} IN ('hit', 'new')`
    )
  ]
);

export type CategoryRecord = typeof categories.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
