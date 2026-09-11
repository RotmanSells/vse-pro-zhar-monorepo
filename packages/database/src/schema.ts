import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
    version: integer("version").notNull().default(1),
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
    check("categories_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("categories_version_check", sql`${table.version} > 0`)
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

export const customers = pgTable(
  "customers",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    phone: varchar("phone", { length: 16 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    birthDate: date("birth_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      "customers_phone_format_check",
      sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`
    ),
    check(
      "customers_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`
    ),
    check(
      "customers_birth_date_check",
      sql`${table.birthDate} IS NULL OR (${table.birthDate} >= DATE '1900-01-01' AND ${table.birthDate} <= CURRENT_DATE)`
    )
  ]
);

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("customer_sessions_customer_id_idx").on(table.customerId),
    index("customer_sessions_expires_at_idx").on(table.expiresAt)
  ]
);

export const customerNotificationDevices = pgTable(
  "customer_notification_devices",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 16 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    token: varchar("token", { length: 512 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("customer_notification_devices_provider_token_unique").on(table.provider, table.token),
    index("customer_notification_devices_customer_id_idx").on(table.customerId),
    check("customer_notification_devices_provider_check", sql`${table.provider} = 'expo'`),
    check("customer_notification_devices_platform_check", sql`${table.platform} IN ('ios', 'android')`),
    check("customer_notification_devices_token_not_blank_check", sql`length(btrim(${table.token})) > 0`),
    check("customer_notification_devices_idempotency_not_blank_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    check("customer_notification_devices_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const customerNotificationPreferences = pgTable(
  "customer_notification_preferences",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" })
      .unique(),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    smsEnabled: boolean("sms_enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("customer_notification_preferences_customer_id_idx").on(table.customerId)]
);

export const customerNotificationDeliveries = pgTable(
  "customer_notification_deliveries",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    deviceId: integer("device_id")
      .notNull()
      .references(() => customerNotificationDevices.id, { onDelete: "cascade", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 16 }).notNull().default("expo"),
    requestKey: varchar("request_key", { length: 255 }).notNull(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    providerTicketId: varchar("provider_ticket_id", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("customer_notification_deliveries_request_device_unique").on(table.requestKey, table.deviceId),
    unique("customer_notification_deliveries_provider_ticket_unique").on(table.provider, table.providerTicketId),
    index("customer_notification_deliveries_customer_id_idx").on(table.customerId),
    index("customer_notification_deliveries_request_key_idx").on(table.requestKey),
    check("customer_notification_deliveries_provider_check", sql`${table.provider} = 'expo'`),
    check("customer_notification_deliveries_status_check", sql`${table.status} IN ('pending', 'accepted', 'delivered', 'failed', 'reconciliation_required')`),
    check("customer_notification_deliveries_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const smsAuthChallenges = pgTable(
  "sms_auth_challenges",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    phone: varchar("phone", { length: 16 }).notNull(),
    purpose: varchar("purpose", { length: 16 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("sms_auth_challenges_phone_created_at_idx").on(table.phone, table.createdAt),
    check("sms_auth_challenges_phone_format_check", sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("sms_auth_challenges_purpose_check", sql`${table.purpose} = 'login'`),
    check("sms_auth_challenges_code_hash_check", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("sms_auth_challenges_attempts_check", sql`${table.attempts} BETWEEN 0 AND 5`)
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, {
        onDelete: "restrict",
        onUpdate: "cascade"
      }),
    pickupLocationId: varchar("pickup_location_id", { length: 160 }).notNull(),
    pickupLocationName: varchar("pickup_location_name", { length: 240 }).notNull(),
    pickupLocationAddress: varchar("pickup_location_address", { length: 240 }).notNull(),
    pickupLocationTimezone: varchar("pickup_location_timezone", { length: 80 }).notNull(),
    pickupSlotId: varchar("pickup_slot_id", { length: 160 }).notNull(),
    pickupSlotLabel: varchar("pickup_slot_label", { length: 240 }).notNull(),
    pickupSlotStartsAt: timestamp("pickup_slot_starts_at", { withTimezone: true }).notNull(),
    pickupSlotEndsAt: timestamp("pickup_slot_ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("orders_customer_id_idempotency_key_unique").on(
      table.customerId,
      table.idempotencyKey
    ),
    index("orders_customer_id_created_at_idx").on(
      table.customerId,
      table.createdAt
    ),
    check(
      "orders_status_check",
      sql`${table.status} IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem', 'canceled')`
    ),
    check("orders_total_minor_check", sql`${table.totalMinor} >= 0`),
    check("orders_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "orders_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    check(
      "orders_payload_fingerprint_check",
      sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "orders_pickup_slot_range_check",
      sql`${table.pickupSlotEndsAt} > ${table.pickupSlotStartsAt}`
    )
  ]
);

export const orderCustomerSnapshots = pgTable(
  "order_customer_snapshots",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" })
      .unique(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    phone: varchar("phone", { length: 16 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("order_customer_snapshots_customer_id_idx").on(table.customerId),
    check(
      "order_customer_snapshots_phone_format_check",
      sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`
    ),
    check(
      "order_customer_snapshots_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`
    )
  ]
);

export const staffUsers = pgTable(
  "staff_users",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    login: varchar("login", { length: 80 }).notNull().unique(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check("staff_users_login_format_check", sql`${table.login} ~ '^[a-z0-9][a-z0-9._-]{0,79}$'`),
    check("staff_users_display_name_not_blank_check", sql`length(btrim(${table.displayName})) > 0`),
    check("staff_users_password_hash_not_blank_check", sql`length(btrim(${table.passwordHash})) > 0`)
  ]
);

export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    staffUserId: integer("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("staff_sessions_staff_user_id_idx").on(table.staffUserId),
    index("staff_sessions_expires_at_idx").on(table.expiresAt)
  ]
);

export const staffAuditLog = pgTable(
  "staff_audit_log",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    staffUserId: integer("staff_user_id").references(() => staffUsers.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    action: varchar("action", { length: 64 }).notNull(),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
      onUpdate: "cascade"
    }),
    requestId: varchar("request_id", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("staff_audit_log_staff_user_id_created_at_idx").on(table.staffUserId, table.createdAt),
    index("staff_audit_log_order_id_created_at_idx").on(table.orderId, table.createdAt),
    index("staff_audit_log_created_at_idx").on(table.createdAt),
    check(
      "staff_audit_log_action_check",
      sql`${table.action} IN ('staff_login', 'staff_logout', 'order_fulfillment_retry', 'order_cancel', 'refund_reconcile')`
    ),
    check(
      "staff_audit_log_request_id_check",
      sql`${table.requestId} IS NULL OR length(btrim(${table.requestId})) > 0`
    )
  ]
);

export const categoryVersions = pgTable(
  "category_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    action: varchar("action", { length: 16 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    isVisible: boolean("is_visible").notNull(),
    actorStaffUserId: integer("actor_staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("category_versions_category_version_unique").on(table.categoryId, table.version),
    index("category_versions_category_created_at_idx").on(table.categoryId, table.createdAt, table.id),
    check("category_versions_action_check", sql`${table.action} IN ('created', 'updated', 'archived')`),
    check("category_versions_slug_format_check", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("category_versions_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check("category_versions_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("category_versions_version_check", sql`${table.version} > 0`),
    check("category_versions_request_id_check", sql`length(btrim(${table.requestId})) > 0`),
    check("category_versions_idempotency_key_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    check("category_versions_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`)
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    productId: integer("product_id").notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull()
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    check("order_items_product_id_check", sql`${table.productId} > 0`),
    check(
      "order_items_product_name_not_blank_check",
      sql`length(btrim(${table.productName})) > 0`
    ),
    check("order_items_unit_price_minor_check", sql`${table.unitPriceMinor} >= 0`),
    check("order_items_quantity_check", sql`${table.quantity} BETWEEN 1 AND 99`),
    check("order_items_line_total_minor_check", sql`${table.lineTotalMinor} >= 0`)
  ]
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: varchar("status", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("order_status_history_order_id_status_unique").on(
      table.orderId,
      table.status
    ),
    index("order_status_history_order_id_created_at_idx").on(
      table.orderId,
      table.createdAt
    ),
    check(
      "order_status_history_status_check",
      sql`${table.status} IN ('pending_payment', 'payment_confirmed', 'kitchen_accepted', 'preparing', 'ready_for_pickup', 'completed', 'fulfillment_problem', 'canceled')`
    )
  ]
);

export const orderIikoItems = pgTable(
  "order_iiko_items",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    orderItemId: integer("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade", onUpdate: "cascade" })
      .unique(),
    productId: integer("product_id").notNull(),
    iikoProductId: varchar("iiko_product_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("order_iiko_items_order_id_product_id_unique").on(
      table.orderId,
      table.productId
    ),
    index("order_iiko_items_order_id_idx").on(table.orderId),
    check("order_iiko_items_product_id_check", sql`${table.productId} > 0`),
    check(
      "order_iiko_items_mapping_not_blank_check",
      sql`${table.iikoProductId} IS NULL OR length(btrim(${table.iikoProductId})) > 0`
    )
  ]
);

export const iikoOrderDispatches = pgTable(
  "iiko_order_dispatches",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" })
      .unique(),
    correlationId: varchar("correlation_id", { length: 160 }).notNull().unique(),
    providerOrderId: varchar("provider_order_id", { length: 160 }).unique(),
    commandId: varchar("command_id", { length: 160 }),
    status: varchar("status", { length: 32 }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("iiko_order_dispatches_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.id
    ),
    check(
      "iiko_order_dispatches_status_check",
      sql`${table.status} IN ('pending', 'creating', 'command_pending', 'submitted', 'failed')`
    ),
    check("iiko_order_dispatches_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "iiko_order_dispatches_correlation_id_not_blank_check",
      sql`length(btrim(${table.correlationId})) > 0`
    ),
    check(
      "iiko_order_dispatches_error_code_not_blank_check",
      sql`${table.lastErrorCode} IS NULL OR length(btrim(${table.lastErrorCode})) > 0`
    )
  ]
);

export const payments = pgTable(
  "payments",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerPaymentId: varchar("provider_payment_id", { length: 160 })
      .notNull()
      .unique(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    providerStatus: varchar("provider_status", { length: 32 }).notNull(),
    confirmationType: varchar("confirmation_type", { length: 32 }),
    confirmationUrl: text("confirmation_url"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("payments_customer_id_idempotency_key_unique").on(
      table.customerId,
      table.idempotencyKey
    ),
    uniqueIndex("payments_order_active_unique")
      .on(table.orderId)
      .where(sql`${table.status} IN ('pending', 'succeeded')`),
    index("payments_order_id_idx").on(table.orderId),
    index("payments_customer_id_created_at_idx").on(
      table.customerId,
      table.createdAt
    ),
    check("payments_provider_check", sql`${table.provider} = 'yookassa'`),
    check(
      "payments_provider_payment_id_not_blank_check",
      sql`length(btrim(${table.providerPaymentId})) > 0`
    ),
    check("payments_amount_minor_check", sql`${table.amountMinor} >= 0`),
    check("payments_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payments_status_check",
      sql`${table.status} IN ('pending', 'succeeded', 'canceled')`
    ),
    check(
      "payments_provider_status_check",
      sql`${table.providerStatus} IN ('pending', 'waiting_for_capture', 'succeeded', 'canceled')`
    ),
    check(
      "payments_confirmation_check",
      sql`(${table.confirmationType} IS NULL AND ${table.confirmationUrl} IS NULL) OR (${table.confirmationType} = 'redirect' AND length(btrim(${table.confirmationUrl})) > 0)`
    ),
    check(
      "payments_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    check(
      "payments_payload_fingerprint_check",
      sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`
    )
  ]
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerPaymentId: varchar("provider_payment_id", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    eventFingerprint: varchar("event_fingerprint", { length: 64 }).notNull(),
    providerStatus: varchar("provider_status", { length: 32 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("payment_events_provider_fingerprint_unique").on(
      table.provider,
      table.eventFingerprint
    ),
    index("payment_events_provider_payment_id_idx").on(
      table.provider,
      table.providerPaymentId
    ),
    check("payment_events_provider_check", sql`${table.provider} = 'yookassa'`),
    check(
      "payment_events_provider_payment_id_not_blank_check",
      sql`length(btrim(${table.providerPaymentId})) > 0`
    ),
    check(
      "payment_events_event_type_not_blank_check",
      sql`length(btrim(${table.eventType})) > 0`
    ),
    check(
      "payment_events_event_fingerprint_check",
      sql`${table.eventFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "payment_events_provider_status_check",
      sql`${table.providerStatus} IN ('pending', 'waiting_for_capture', 'succeeded', 'canceled')`
    )
  ]
);

export const orderCancellations = pgTable(
  "order_cancellations",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" })
      .unique(),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    staffUserId: integer("staff_user_id").references(() => staffUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("order_cancellations_order_idempotency_key_unique").on(
      table.orderId,
      table.idempotencyKey
    ),
    check(
      "order_cancellations_actor_check",
      sql`(${table.actorType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffUserId} IS NULL) OR (${table.actorType} = 'admin' AND ${table.customerId} IS NULL AND ${table.staffUserId} IS NOT NULL)`
    ),
    check(
      "order_cancellations_actor_type_check",
      sql`${table.actorType} IN ('customer', 'admin')`
    ),
    check(
      "order_cancellations_reason_code_check",
      sql`${table.reasonCode} IN ('customer_requested', 'admin_requested')`
    ),
    check(
      "order_cancellations_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    )
  ]
);

export const refunds = pgTable(
  "refunds",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" })
      .unique(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict", onUpdate: "cascade" })
      .unique(),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerRefundId: varchar("provider_refund_id", { length: 160 }).unique(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("refunds_due_idx").on(table.status, table.nextAttemptAt, table.id),
    index("refunds_order_id_idx").on(table.orderId),
    check("refunds_provider_check", sql`${table.provider} = 'yookassa'`),
    check("refunds_amount_minor_check", sql`${table.amountMinor} >= 0`),
    check("refunds_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "refunds_status_check",
      sql`${table.status} IN ('pending', 'succeeded', 'canceled', 'reconciliation_required')`
    ),
    check("refunds_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "refunds_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    check(
      "refunds_provider_refund_id_not_blank_check",
      sql`${table.providerRefundId} IS NULL OR length(btrim(${table.providerRefundId})) > 0`
    ),
    check(
      "refunds_error_code_not_blank_check",
      sql`${table.lastErrorCode} IS NULL OR length(btrim(${table.lastErrorCode})) > 0`
    )
  ]
);

export const refundEvents = pgTable(
  "refund_events",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerRefundId: varchar("provider_refund_id", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    eventFingerprint: varchar("event_fingerprint", { length: 64 }).notNull(),
    providerStatus: varchar("provider_status", { length: 32 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("refund_events_provider_fingerprint_unique").on(
      table.provider,
      table.eventFingerprint
    ),
    index("refund_events_provider_refund_id_idx").on(
      table.provider,
      table.providerRefundId
    ),
    check("refund_events_provider_check", sql`${table.provider} = 'yookassa'`),
    check(
      "refund_events_provider_refund_id_not_blank_check",
      sql`length(btrim(${table.providerRefundId})) > 0`
    ),
    check(
      "refund_events_event_type_not_blank_check",
      sql`length(btrim(${table.eventType})) > 0`
    ),
    check(
      "refund_events_event_fingerprint_check",
      sql`${table.eventFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "refund_events_provider_status_check",
      sql`${table.providerStatus} IN ('pending', 'succeeded', 'canceled')`
    )
  ]
);

export const promoDefinitions = pgTable(
  "promo_definitions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    description: varchar("description", { length: 240 }).notNull().default(""),
    promoType: varchar("promo_type", { length: 16 }).notNull(),
    value: integer("value").notNull(),
    minimumOrderMinor: bigint("minimum_order_minor", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("RUB"),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    globalUsageLimit: integer("global_usage_limit"),
    perCustomerUsageLimit: integer("per_customer_usage_limit"),
    stackingPolicy: varchar("stacking_policy", { length: 16 }).notNull().default("none"),
    isActive: boolean("is_active").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdByStaffUserId: integer("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null", onUpdate: "cascade" }),
    updatedByStaffUserId: integer("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null", onUpdate: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("promo_definitions_status_created_at_idx").on(table.isArchived, table.isActive, table.createdAt, table.id),
    check("promo_definitions_code_format_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`),
    check("promo_definitions_description_length_check", sql`length(${table.description}) <= 240`),
    check("promo_definitions_type_check", sql`${table.promoType} IN ('percent', 'fixed')`),
    check("promo_definitions_value_check", sql`(${table.promoType} = 'percent' AND ${table.value} BETWEEN 1 AND 100) OR (${table.promoType} = 'fixed' AND ${table.value} BETWEEN 1 AND 1000000000)`),
    check("promo_definitions_minimum_order_check", sql`${table.minimumOrderMinor} BETWEEN 0 AND 1000000000`),
    check("promo_definitions_currency_check", sql`${table.currency} = 'RUB'`),
    check("promo_definitions_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`),
    check("promo_definitions_global_limit_check", sql`${table.globalUsageLimit} IS NULL OR ${table.globalUsageLimit} BETWEEN 1 AND 2147483647`),
    check("promo_definitions_customer_limit_check", sql`${table.perCustomerUsageLimit} IS NULL OR ${table.perCustomerUsageLimit} BETWEEN 1 AND 2147483647`),
    check("promo_definitions_stacking_policy_check", sql`${table.stackingPolicy} = 'none'`),
    check("promo_definitions_archive_state_check", sql`${table.isArchived} = false OR ${table.isActive} = false`),
    check("promo_definitions_version_check", sql`${table.version} > 0`)
  ]
);

export const promoDefinitionVersions = pgTable(
  "promo_definition_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    promoDefinitionId: integer("promo_definition_id").notNull().references(() => promoDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    promoType: varchar("promo_type", { length: 16 }).notNull(),
    value: integer("value").notNull(),
    minimumOrderMinor: bigint("minimum_order_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    globalUsageLimit: integer("global_usage_limit"),
    perCustomerUsageLimit: integer("per_customer_usage_limit"),
    stackingPolicy: varchar("stacking_policy", { length: 16 }).notNull(),
    isActive: boolean("is_active").notNull(),
    isArchived: boolean("is_archived").notNull(),
    actorStaffUserId: integer("actor_staff_user_id").references(() => staffUsers.id, { onDelete: "set null", onUpdate: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("promo_definition_versions_definition_version_unique").on(table.promoDefinitionId, table.version),
    index("promo_definition_versions_definition_created_at_idx").on(table.promoDefinitionId, table.createdAt),
    check("promo_definition_versions_code_format_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`),
    check("promo_definition_versions_type_check", sql`${table.promoType} IN ('percent', 'fixed')`),
    check("promo_definition_versions_currency_check", sql`${table.currency} = 'RUB'`),
    check("promo_definition_versions_value_check", sql`(${table.promoType} = 'percent' AND ${table.value} BETWEEN 1 AND 100) OR (${table.promoType} = 'fixed' AND ${table.value} BETWEEN 1 AND 1000000000)`),
    check("promo_definition_versions_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`),
    check("promo_definition_versions_version_check", sql`${table.version} > 0`)
  ]
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    promoDefinitionId: integer("promo_definition_id").notNull().references(() => promoDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    orderId: integer("order_id").references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceKey: varchar("source_key", { length: 255 }).notNull().unique(),
    promoCode: varchar("promo_code", { length: 32 }).notNull(),
    promoVersion: integer("promo_version").notNull(),
    promoType: varchar("promo_type", { length: 16 }).notNull(),
    promoValue: integer("promo_value").notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull(),
    preDiscountTotalMinor: bigint("pre_discount_total_minor", { mode: "number" }).notNull(),
    finalTotalMinor: bigint("final_total_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("promo_redemptions_customer_order_definition_unique").on(table.customerId, table.orderId, table.promoDefinitionId),
    index("promo_redemptions_definition_status_idx").on(table.promoDefinitionId, table.status, table.createdAt),
    index("promo_redemptions_customer_created_at_idx").on(table.customerId, table.createdAt),
    check("promo_redemptions_source_key_not_blank_check", sql`length(btrim(${table.sourceKey})) > 0`),
    check("promo_redemptions_code_format_check", sql`${table.promoCode} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`),
    check("promo_redemptions_type_check", sql`${table.promoType} IN ('percent', 'fixed')`),
    check("promo_redemptions_value_check", sql`(${table.promoType} = 'percent' AND ${table.promoValue} BETWEEN 1 AND 100) OR (${table.promoType} = 'fixed' AND ${table.promoValue} BETWEEN 1 AND 1000000000)`),
    check("promo_redemptions_discount_check", sql`${table.discountMinor} BETWEEN 0 AND ${table.preDiscountTotalMinor}`),
    check("promo_redemptions_totals_check", sql`${table.preDiscountTotalMinor} >= 0 AND ${table.finalTotalMinor} >= 0 AND ${table.finalTotalMinor} + ${table.discountMinor} = ${table.preDiscountTotalMinor}`),
    check("promo_redemptions_currency_check", sql`${table.currency} = 'RUB'`),
    check("promo_redemptions_status_check", sql`${table.status} IN ('pending', 'succeeded', 'canceled', 'reconciliation_required')`)
  ]
);

export const communicationTemplateVersions = pgTable(
  "communication_template_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    version: integer("version").notNull(),
    icon: varchar("icon", { length: 4 }).notNull(),
    title: varchar("title", { length: 80 }).notNull(),
    body: text("body").notNull(),
    variables: text("variables").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("communication_template_versions_code_version_unique").on(table.code, table.version),
    check("communication_template_versions_code_format_check", sql`${table.code} ~ '^[a-z][a-z0-9_-]{0,31}$'`),
    check("communication_template_versions_version_check", sql`${table.version} > 0`),
    check("communication_template_versions_title_not_blank_check", sql`length(btrim(${table.title})) > 0`),
    check("communication_template_versions_body_length_check", sql`length(btrim(${table.body})) BETWEEN 1 AND 2000`)
  ]
);

export const communicationDrafts = pgTable(
  "communication_drafts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    templateCode: varchar("template_code", { length: 32 }).notNull(),
    templateVersion: integer("template_version").notNull(),
    templateTitle: varchar("template_title", { length: 80 }).notNull(),
    body: text("body").notNull(),
    channel: varchar("channel", { length: 8 }).notNull(),
    delaySeconds: integer("delay_seconds").notNull().default(0),
    segmentCode: varchar("segment_code", { length: 40 }).notNull(),
    segmentDefinitionId: varchar("segment_definition_id", { length: 80 }).notNull(),
    segmentDefinitionVersion: integer("segment_definition_version").notNull(),
    previewCount: integer("preview_count"),
    previewGeneratedAt: timestamp("preview_generated_at", { withTimezone: true }),
    previewSegmentAsOf: timestamp("preview_segment_as_of", { withTimezone: true }),
    promoDefinitionId: integer("promo_definition_id").references(() => promoDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    promoDefinitionVersion: integer("promo_definition_version"),
    promoCode: varchar("promo_code", { length: 32 }),
    promoType: varchar("promo_type", { length: 16 }),
    promoValue: integer("promo_value"),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    createdByStaffUserId: integer("created_by_staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1)
  },
  (table) => [
    foreignKey({
      columns: [table.templateCode, table.templateVersion],
      foreignColumns: [communicationTemplateVersions.code, communicationTemplateVersions.version],
      name: "communication_drafts_template_version_fk"
    }),
    index("communication_drafts_status_updated_at_idx").on(table.status, table.updatedAt, table.id),
    index("communication_drafts_segment_code_idx").on(table.segmentCode),
    index("communication_drafts_created_by_staff_user_id_idx").on(table.createdByStaffUserId),
    check("communication_drafts_idempotency_key_not_blank_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    check("communication_drafts_payload_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("communication_drafts_body_length_check", sql`length(btrim(${table.body})) BETWEEN 1 AND 2000`),
    check("communication_drafts_channel_check", sql`${table.channel} IN ('push', 'sms')`),
    check("communication_drafts_delay_seconds_check", sql`${table.delaySeconds} BETWEEN 0 AND 86400`),
    check("communication_drafts_segment_definition_version_check", sql`${table.segmentDefinitionVersion} > 0`),
    check("communication_drafts_status_check", sql`${table.status} IN ('draft', 'previewed', 'archived')`),
    check("communication_drafts_version_check", sql`${table.version} > 0`),
    check("communication_drafts_archive_state_check", sql`(${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL) OR (${table.status} <> 'archived' AND ${table.archivedAt} IS NULL)`),
    check("communication_drafts_preview_metadata_check", sql`(((${table.previewCount} IS NULL AND ${table.previewGeneratedAt} IS NULL AND ${table.previewSegmentAsOf} IS NULL) OR (${table.previewCount} IS NOT NULL AND ${table.previewCount} >= 0 AND ${table.previewGeneratedAt} IS NOT NULL AND ${table.previewSegmentAsOf} IS NOT NULL)) AND (${table.status} <> 'previewed' OR (${table.previewCount} IS NOT NULL AND ${table.previewGeneratedAt} IS NOT NULL AND ${table.previewSegmentAsOf} IS NOT NULL)))`),
    check("communication_drafts_promo_snapshot_check", sql`(${table.promoDefinitionId} IS NULL AND ${table.promoDefinitionVersion} IS NULL AND ${table.promoCode} IS NULL AND ${table.promoType} IS NULL AND ${table.promoValue} IS NULL) OR (${table.promoDefinitionId} IS NOT NULL AND ${table.promoDefinitionVersion} IS NOT NULL AND ${table.promoDefinitionVersion} > 0 AND ${table.promoCode} IS NOT NULL AND ${table.promoType} IN ('percent', 'fixed') AND ${table.promoValue} IS NOT NULL AND ${table.promoValue} > 0)`)
  ]
);

export const communicationDraftAudit = pgTable(
  "communication_draft_audit",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    draftId: integer("draft_id").notNull().references(() => communicationDrafts.id, { onDelete: "restrict", onUpdate: "cascade" }),
    action: varchar("action", { length: 16 }).notNull(),
    fromStatus: varchar("from_status", { length: 16 }),
    toStatus: varchar("to_status", { length: 16 }).notNull(),
    actorStaffUserId: integer("actor_staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("communication_draft_audit_draft_created_at_idx").on(table.draftId, table.createdAt, table.id),
    check("communication_draft_audit_action_check", sql`${table.action} IN ('created', 'updated', 'previewed', 'archived', 'restored')`),
    check("communication_draft_audit_from_status_check", sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('draft', 'previewed', 'archived')`),
    check("communication_draft_audit_to_status_check", sql`${table.toStatus} IN ('draft', 'previewed', 'archived')`),
    check("communication_draft_audit_version_check", sql`${table.version} > 0`),
    check("communication_draft_audit_transition_check", sql`(${table.action} = 'created' AND ${table.fromStatus} IS NULL AND ${table.toStatus} = 'draft' AND ${table.version} = 1) OR (${table.action} <> 'created' AND ${table.fromStatus} IS NOT NULL)`)
  ]
);

export const loyaltyAccounts = pgTable(
  "loyalty_accounts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" })
      .unique(),
    xp: integer("xp").notNull().default(0),
    coalBalance: integer("coal_balance").notNull().default(0),
    rankCode: varchar("rank_code", { length: 32 }).notNull().default("spark"),
    rankVersion: integer("rank_version").notNull().default(1),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("loyalty_accounts_rank_code_idx").on(table.rankCode),
    check("loyalty_accounts_xp_check", sql`${table.xp} BETWEEN 0 AND 2147483647`),
    check(
      "loyalty_accounts_coal_balance_check",
      sql`${table.coalBalance} BETWEEN 0 AND 2147483647`
    ),
    check(
      "loyalty_accounts_rank_code_check",
      sql`${table.rankCode} IN ('spark', 'heat', 'flame', 'volcano')`
    ),
    check("loyalty_accounts_rank_version_check", sql`${table.rankVersion} > 0`),
    check("loyalty_accounts_version_check", sql`${table.version} >= 0`)
  ]
);

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    loyaltyAccountId: integer("loyalty_account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "restrict", onUpdate: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    entryType: varchar("entry_type", { length: 20 }).notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 160 }).notNull(),
    sourceOrderId: integer("source_order_id").references(() => orders.id, {
      onDelete: "restrict",
      onUpdate: "cascade"
    }),
    ruleVersion: integer("rule_version").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    xpDelta: integer("xp_delta").notNull(),
    coalDelta: integer("coal_delta").notNull(),
    xpBalance: integer("xp_balance").notNull(),
    coalBalance: integer("coal_balance").notNull(),
    sourceOrderTotalMinor: bigint("source_order_total_minor", { mode: "number" }),
    sourceOrderCurrency: varchar("source_order_currency", { length: 3 }),
    reason: varchar("reason", { length: 240 }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: integer("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("loyalty_ledger_source_rule_unique").on(
      table.sourceType,
      table.sourceId,
      table.ruleVersion
    ),
    index("loyalty_ledger_customer_created_at_idx").on(table.customerId, table.createdAt, table.id),
    index("loyalty_ledger_source_order_id_idx").on(table.sourceOrderId),
    check(
      "loyalty_ledger_entry_type_check",
      sql`${table.entryType} IN ('earned', 'spent', 'correction')`
    ),
    check(
      "loyalty_ledger_source_type_check",
      sql`${table.sourceType} IN ('completed_order', 'redemption', 'admin_correction', 'wheel_spin', 'quest_reward')`
    ),
    check("loyalty_ledger_rule_version_check", sql`${table.ruleVersion} > 0`),
    check(
      "loyalty_ledger_source_id_not_blank_check",
      sql`length(btrim(${table.sourceId})) > 0`
    ),
    check(
      "loyalty_ledger_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    check(
      "loyalty_ledger_reason_not_blank_check",
      sql`length(btrim(${table.reason})) > 0`
    ),
    check(
      "loyalty_ledger_actor_type_check",
      sql`${table.actorType} IN ('system', 'customer', 'admin')`
    ),
    check("loyalty_ledger_xp_delta_check", sql`${table.xpDelta} BETWEEN -2147483647 AND 2147483647`),
    check(
      "loyalty_ledger_coal_delta_check",
      sql`${table.coalDelta} BETWEEN -2147483647 AND 2147483647`
    ),
    check("loyalty_ledger_xp_balance_check", sql`${table.xpBalance} BETWEEN 0 AND 2147483647`),
    check(
      "loyalty_ledger_coal_balance_check",
      sql`${table.coalBalance} BETWEEN 0 AND 2147483647`
    ),
    check(
      "loyalty_ledger_source_order_snapshot_check",
      sql`(${table.sourceType} IN ('completed_order', 'wheel_spin') AND ${table.entryType} = 'earned' AND ${table.sourceOrderId} IS NOT NULL AND ${table.sourceOrderTotalMinor} IS NOT NULL AND ${table.sourceOrderCurrency} IS NOT NULL) OR (${table.sourceType} IN ('redemption', 'admin_correction', 'quest_reward') AND ${table.sourceOrderId} IS NULL AND ${table.sourceOrderTotalMinor} IS NULL AND ${table.sourceOrderCurrency} IS NULL)`
    ),
    check(
      "loyalty_ledger_source_order_currency_check",
      sql`${table.sourceOrderCurrency} IS NULL OR ${table.sourceOrderCurrency} ~ '^[A-Z]{3}$'`
    ),
    check(
      "loyalty_ledger_source_order_total_check",
      sql`${table.sourceOrderTotalMinor} IS NULL OR ${table.sourceOrderTotalMinor} >= 0`
    ),
    check(
      "loyalty_ledger_entry_semantics_check",
      sql`(${table.entryType} = 'earned' AND ${table.sourceType} IN ('completed_order', 'wheel_spin', 'quest_reward') AND ${table.actorType} = 'system' AND ${table.xpDelta} >= 0 AND ${table.coalDelta} >= 0) OR (${table.entryType} = 'spent' AND ${table.sourceType} = 'redemption' AND ${table.actorType} = 'customer' AND ${table.xpDelta} = 0 AND ${table.coalDelta} < 0) OR (${table.entryType} = 'correction' AND ${table.sourceType} = 'admin_correction' AND ${table.actorType} = 'admin' AND (${table.xpDelta} <> 0 OR ${table.coalDelta} <> 0))`
    )
  ]
);

export const loyaltyRankHistory = pgTable(
  "loyalty_rank_history",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    loyaltyAccountId: integer("loyalty_account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "restrict", onUpdate: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    oldRankCode: varchar("old_rank_code", { length: 32 }),
    newRankCode: varchar("new_rank_code", { length: 32 }).notNull(),
    xpSnapshot: integer("xp_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("loyalty_rank_history_customer_created_at_idx").on(
      table.customerId,
      table.createdAt,
      table.id
    ),
    check(
      "loyalty_rank_history_old_rank_check",
      sql`${table.oldRankCode} IS NULL OR ${table.oldRankCode} IN ('spark', 'heat', 'flame', 'volcano')`
    ),
    check(
      "loyalty_rank_history_new_rank_check",
      sql`${table.newRankCode} IN ('spark', 'heat', 'flame', 'volcano')`
    ),
    check(
      "loyalty_rank_history_different_rank_check",
      sql`${table.oldRankCode} IS NULL OR ${table.oldRankCode} <> ${table.newRankCode}`
    ),
    check(
      "loyalty_rank_history_xp_snapshot_check",
      sql`${table.xpSnapshot} BETWEEN 0 AND 2147483647`
    )
  ]
);

export const loyaltyRewards = pgTable(
  "loyalty_rewards",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull().default(""),
    costCoal: integer("cost_coal").notNull(),
    rewardType: varchar("reward_type", { length: 32 }).notNull().default("fixed_discount"),
    fulfillmentTargetType: varchar("fulfillment_target_type", { length: 32 }).notNull().default("fixed_discount"),
    fulfillmentDiscountMinor: bigint("fulfillment_discount_minor", { mode: "number" }),
    isVisible: boolean("is_visible").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    perCustomerUsageLimit: integer("per_customer_usage_limit").default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("loyalty_rewards_visibility_sort_idx").on(table.isVisible, table.sortOrder, table.id),
    check("loyalty_rewards_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
    check("loyalty_rewards_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check("loyalty_rewards_cost_check", sql`${table.costCoal} BETWEEN 1 AND 2147483647`),
    check("loyalty_rewards_type_check", sql`${table.rewardType} = 'fixed_discount'`),
    check("loyalty_rewards_target_type_check", sql`${table.fulfillmentTargetType} = 'fixed_discount'`),
    check("loyalty_rewards_discount_check", sql`${table.fulfillmentDiscountMinor} BETWEEN 1 AND 2147483647`),
    check("loyalty_rewards_usage_limit_check", sql`${table.perCustomerUsageLimit} IS NULL OR ${table.perCustomerUsageLimit} BETWEEN 1 AND 2147483647`),
    check("loyalty_rewards_archive_visibility_check", sql`${table.isArchived} = false OR ${table.isVisible} = false`),
    check("loyalty_rewards_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("loyalty_rewards_version_check", sql`${table.version} > 0`),
    check(
      "loyalty_rewards_active_period_check",
      sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`
    )
  ]
);

export const loyaltyRewardVersions = pgTable(
  "loyalty_reward_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    rewardId: integer("reward_id").notNull().references(() => loyaltyRewards.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    action: varchar("action", { length: 16 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull(),
    costCoal: integer("cost_coal").notNull(),
    rewardType: varchar("reward_type", { length: 32 }).notNull(),
    fulfillmentTargetType: varchar("fulfillment_target_type", { length: 32 }).notNull(),
    fulfillmentDiscountMinor: bigint("fulfillment_discount_minor", { mode: "number" }).notNull(),
    isVisible: boolean("is_visible").notNull(),
    isArchived: boolean("is_archived").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull(),
    perCustomerUsageLimit: integer("per_customer_usage_limit"),
    actorStaffUserId: integer("actor_staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("loyalty_reward_versions_reward_version_unique").on(table.rewardId, table.version),
    index("loyalty_reward_versions_reward_created_at_idx").on(table.rewardId, table.createdAt, table.id),
    check("loyalty_reward_versions_action_check", sql`${table.action} IN ('created', 'updated', 'archived')`),
    check("loyalty_reward_versions_version_check", sql`${table.version} > 0`),
    check("loyalty_reward_versions_type_check", sql`${table.rewardType} = 'fixed_discount' AND ${table.fulfillmentTargetType} = 'fixed_discount'`),
    check("loyalty_reward_versions_cost_check", sql`${table.costCoal} BETWEEN 1 AND 2147483647`),
    check("loyalty_reward_versions_discount_check", sql`${table.fulfillmentDiscountMinor} BETWEEN 1 AND 2147483647`),
    check("loyalty_reward_versions_archive_visibility_check", sql`${table.isArchived} = false OR ${table.isVisible} = false`),
    check("loyalty_reward_versions_request_id_check", sql`length(btrim(${table.requestId})) > 0`),
    check("loyalty_reward_versions_payload_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("loyalty_reward_versions_idempotency_check", sql`length(btrim(${table.idempotencyKey})) > 0`)
  ]
);

export const loyaltyRedemptions = pgTable(
  "loyalty_redemptions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    loyaltyAccountId: integer("loyalty_account_id")
      .notNull()
      .references(() => loyaltyAccounts.id, { onDelete: "restrict", onUpdate: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rewardId: integer("reward_id")
      .notNull()
      .references(() => loyaltyRewards.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rewardCode: varchar("reward_code", { length: 80 }).notNull(),
    rewardName: varchar("reward_name", { length: 160 }).notNull(),
    costCoal: integer("cost_coal").notNull(),
    rewardType: varchar("reward_type", { length: 32 }).notNull(),
    fulfillmentTargetType: varchar("fulfillment_target_type", { length: 32 }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true })
  },
  (table) => [
    index("loyalty_redemptions_customer_created_at_idx").on(
      table.customerId,
      table.createdAt,
      table.id
    ),
    check("loyalty_redemptions_reward_code_not_blank_check", sql`length(btrim(${table.rewardCode})) > 0`),
    check("loyalty_redemptions_reward_name_not_blank_check", sql`length(btrim(${table.rewardName})) > 0`),
    check("loyalty_redemptions_cost_check", sql`${table.costCoal} BETWEEN 1 AND 2147483647`),
    check("loyalty_redemptions_type_check", sql`${table.rewardType} = 'fixed_discount' AND ${table.fulfillmentTargetType} = 'fixed_discount'`),
    check("loyalty_redemptions_discount_check", sql`${table.discountMinor} BETWEEN 1 AND 2147483647`),
    check("loyalty_redemptions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "loyalty_redemptions_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`
    ),
    check(
      "loyalty_redemptions_status_check",
      sql`${table.status} IN ('pending', 'succeeded', 'canceled', 'reconciliation_required')`
    )
  ]
);

export const loyaltyRedemptionOrders = pgTable(
  "loyalty_redemption_orders",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    redemptionId: integer("redemption_id").notNull().references(() => loyaltyRedemptions.id, { onDelete: "restrict", onUpdate: "cascade" }).unique(),
    orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }).unique(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rewardCode: varchar("reward_code", { length: 80 }).notNull(),
    rewardName: varchar("reward_name", { length: 160 }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("loyalty_redemption_orders_customer_created_at_idx").on(table.customerId, table.createdAt, table.id),
    check("loyalty_redemption_orders_code_not_blank_check", sql`length(btrim(${table.rewardCode})) > 0`),
    check("loyalty_redemption_orders_name_not_blank_check", sql`length(btrim(${table.rewardName})) > 0`),
    check("loyalty_redemption_orders_discount_check", sql`${table.discountMinor} BETWEEN 1 AND 2147483647`)
  ]
);

export const wheelSettings = pgTable(
  "wheel_settings",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    eligibility: varchar("eligibility", { length: 40 }).notNull().default("completed_paid_order"),
    minOrderAmountMinor: integer("min_order_amount_minor").notNull().default(150000),
    currency: varchar("currency", { length: 3 }).notNull().default("RUB"),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(86400),
    maxSpins: integer("max_spins").notNull().default(1),
    limitPeriodSeconds: integer("limit_period_seconds").notNull().default(86400),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("wheel_settings_singleton_check", sql`${table.id} = 1`),
    check("wheel_settings_eligibility_check", sql`${table.eligibility} = 'completed_paid_order'`),
    check("wheel_settings_min_order_check", sql`${table.minOrderAmountMinor} BETWEEN 0 AND 2147483647`),
    check("wheel_settings_currency_check", sql`${table.currency} = 'RUB'`),
    check("wheel_settings_cooldown_check", sql`${table.cooldownSeconds} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_max_spins_check", sql`${table.maxSpins} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_period_check", sql`${table.limitPeriodSeconds} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_version_check", sql`${table.version} > 0`),
    check("wheel_settings_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const wheelSettingsVersions = pgTable(
  "wheel_settings_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    wheelSettingsId: integer("wheel_settings_id").notNull().references(() => wheelSettings.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    enabled: boolean("enabled").notNull(),
    eligibility: varchar("eligibility", { length: 40 }).notNull(),
    minOrderAmountMinor: integer("min_order_amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull(),
    maxSpins: integer("max_spins").notNull(),
    limitPeriodSeconds: integer("limit_period_seconds").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    actorStaffUserId: integer("actor_staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("wheel_settings_versions_settings_version_unique").on(table.wheelSettingsId, table.version),
    index("wheel_settings_versions_created_at_idx").on(table.createdAt),
    check("wheel_settings_versions_action_check", sql`${table.action} = 'updated'`),
    check("wheel_settings_versions_eligibility_check", sql`${table.eligibility} = 'completed_paid_order'`),
    check("wheel_settings_versions_min_order_check", sql`${table.minOrderAmountMinor} BETWEEN 0 AND 2147483647`),
    check("wheel_settings_versions_currency_check", sql`${table.currency} = 'RUB'`),
    check("wheel_settings_versions_cooldown_check", sql`${table.cooldownSeconds} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_versions_max_spins_check", sql`${table.maxSpins} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_versions_period_check", sql`${table.limitPeriodSeconds} BETWEEN 1 AND 2147483647`),
    check("wheel_settings_versions_version_check", sql`${table.version} > 0`),
    check("wheel_settings_versions_request_id_check", sql`length(btrim(${table.requestId})) > 0`),
    check("wheel_settings_versions_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("wheel_settings_versions_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const wheelPrizes = pgTable(
  "wheel_prizes",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull().default(""),
    prizeType: varchar("prize_type", { length: 20 }).notNull(),
    value: integer("value").notNull(),
    weight: integer("weight").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("wheel_prizes_visibility_sort_idx").on(table.isVisible, table.sortOrder, table.id),
    check("wheel_prizes_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
    check("wheel_prizes_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check("wheel_prizes_type_check", sql`${table.prizeType} IN ('no_prize', 'coal', 'xp')`),
    check("wheel_prizes_value_check", sql`(${table.prizeType} = 'no_prize' AND ${table.value} = 0) OR (${table.prizeType} IN ('coal', 'xp') AND ${table.value} > 0)`),
    check("wheel_prizes_weight_check", sql`${table.weight} BETWEEN 0 AND 2147483647`),
    check("wheel_prizes_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("wheel_prizes_version_check", sql`${table.version} > 0`),
    check("wheel_prizes_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const wheelPrizeVersions = pgTable(
  "wheel_prize_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    wheelPrizeId: integer("wheel_prize_id")
      .notNull()
      .references(() => wheelPrizes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull(),
    prizeType: varchar("prize_type", { length: 20 }).notNull(),
    value: integer("value").notNull(),
    weight: integer("weight").notNull(),
    isVisible: boolean("is_visible").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull(),
    actorStaffUserId: integer("actor_staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("wheel_prize_versions_prize_version_unique").on(table.wheelPrizeId, table.version),
    index("wheel_prize_versions_created_at_idx").on(table.createdAt),
    check("wheel_prize_versions_action_check", sql`${table.action} = 'updated'`),
    check("wheel_prize_versions_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
    check("wheel_prize_versions_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check("wheel_prize_versions_type_check", sql`${table.prizeType} IN ('no_prize', 'coal', 'xp')`),
    check("wheel_prize_versions_value_check", sql`(${table.prizeType} = 'no_prize' AND ${table.value} = 0) OR (${table.prizeType} IN ('coal', 'xp') AND ${table.value} > 0)`),
    check("wheel_prize_versions_weight_check", sql`${table.weight} BETWEEN 0 AND 2147483647`),
    check("wheel_prize_versions_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("wheel_prize_versions_version_check", sql`${table.version} > 0`),
    check("wheel_prize_versions_request_id_check", sql`length(btrim(${table.requestId})) > 0`),
    check("wheel_prize_versions_fingerprint_check", sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("wheel_prize_versions_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const wheelSpins = pgTable(
  "wheel_spins",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceOrderId: integer("source_order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }).unique(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    prizeId: integer("prize_id").notNull().references(() => wheelPrizes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    prizeCode: varchar("prize_code", { length: 80 }).notNull(),
    prizeName: varchar("prize_name", { length: 160 }).notNull(),
    prizeDescription: varchar("prize_description", { length: 2048 }).notNull(),
    prizeType: varchar("prize_type", { length: 20 }).notNull(),
    prizeValue: integer("prize_value").notNull(),
    prizeWeight: integer("prize_weight").notNull(),
    prizeSortOrder: integer("prize_sort_order").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("wheel_spins_customer_id_idempotency_unique").on(table.customerId, table.idempotencyKey),
    index("wheel_spins_customer_created_at_idx").on(table.customerId, table.createdAt, table.id),
    check("wheel_spins_idempotency_not_blank_check", sql`length(btrim(${table.idempotencyKey})) > 0`),
    check("wheel_spins_prize_type_check", sql`${table.prizeType} IN ('no_prize', 'coal', 'xp')`),
    check("wheel_spins_prize_value_check", sql`(${table.prizeType} = 'no_prize' AND ${table.prizeValue} = 0) OR (${table.prizeType} IN ('coal', 'xp') AND ${table.prizeValue} > 0)`),
    check("wheel_spins_prize_weight_check", sql`${table.prizeWeight} >= 0`),
    check("wheel_spins_prize_sort_order_check", sql`${table.prizeSortOrder} >= 0`),
    check("wheel_spins_status_check", sql`${table.status} = 'completed'`)
  ]
);

export const wheelRewardClaims = pgTable(
  "wheel_reward_claims",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    spinId: integer("spin_id").notNull().references(() => wheelSpins.id, { onDelete: "restrict", onUpdate: "cascade" }).unique(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rewardType: varchar("reward_type", { length: 20 }).notNull(),
    rewardValue: integer("reward_value").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("wheel_reward_claims_type_check", sql`${table.rewardType} IN ('no_prize', 'coal', 'xp')`),
    check("wheel_reward_claims_value_check", sql`(${table.rewardType} = 'no_prize' AND ${table.rewardValue} = 0) OR (${table.rewardType} IN ('coal', 'xp') AND ${table.rewardValue} > 0)`),
    check("wheel_reward_claims_status_check", sql`${table.status} IN ('not_applicable', 'succeeded', 'reconciliation_required')`),
    check("wheel_reward_claims_idempotency_not_blank_check", sql`length(btrim(${table.idempotencyKey})) > 0`)
  ]
);

export const questDefinitions = pgTable(
  "quest_definitions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    title: varchar("title", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull().default(""),
    goal: integer("goal").notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    rewardType: varchar("reward_type", { length: 20 }).notNull(),
    rewardValue: integer("reward_value").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("quest_definitions_visibility_sort_idx").on(table.isVisible, table.sortOrder, table.id),
    check("quest_definitions_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
    check("quest_definitions_title_not_blank_check", sql`length(btrim(${table.title})) > 0`),
    check("quest_definitions_goal_check", sql`${table.goal} BETWEEN 1 AND 2147483647`),
    check("quest_definitions_unit_check", sql`${table.unit} IN ('order', 'minor_units')`),
    check("quest_definitions_reward_type_check", sql`${table.rewardType} IN ('xp', 'coal')`),
    check("quest_definitions_reward_value_check", sql`${table.rewardValue} BETWEEN 1 AND 2147483647`),
    check("quest_definitions_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("quest_definitions_version_check", sql`${table.version} > 0`),
    check("quest_definitions_active_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const questDefinitionVersions = pgTable(
  "quest_definition_versions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    questDefinitionId: integer("quest_definition_id").notNull().references(() => questDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: varchar("description", { length: 2048 }).notNull(),
    goal: integer("goal").notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    rewardType: varchar("reward_type", { length: 20 }).notNull(),
    rewardValue: integer("reward_value").notNull(),
    isVisible: boolean("is_visible").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull(),
    actorStaffUserId: integer("actor_staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    payloadFingerprint: varchar("payload_fingerprint", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("quest_definition_versions_definition_version_unique").on(table.questDefinitionId, table.version),
    unique("quest_definition_versions_idempotency_key_unique").on(table.idempotencyKey),
    index("quest_definition_versions_definition_created_at_idx").on(table.questDefinitionId, table.createdAt),
    check("quest_definition_versions_action_check", sql`${table.action} IN ('created', 'updated', 'archived')`),
    check("quest_definition_versions_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
    check("quest_definition_versions_title_not_blank_check", sql`length(btrim(${table.title})) > 0`),
    check("quest_definition_versions_goal_check", sql`${table.goal} BETWEEN 1 AND 2147483647`),
    check("quest_definition_versions_unit_check", sql`${table.unit} IN ('order', 'minor_units')`),
    check("quest_definition_versions_reward_type_check", sql`${table.rewardType} IN ('xp', 'coal')`),
    check("quest_definition_versions_reward_value_check", sql`${table.rewardValue} BETWEEN 1 AND 2147483647`),
    check("quest_definition_versions_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("quest_definition_versions_version_check", sql`${table.version} > 0`),
    check("quest_definition_versions_request_id_check", sql`length(btrim(${table.requestId})) > 0`),
    check("quest_definition_versions_fingerprint_check", sql`${table.payloadFingerprint} IS NULL OR ${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("quest_definition_versions_period_check", sql`${table.activeUntil} IS NULL OR ${table.activeFrom} IS NULL OR ${table.activeUntil} > ${table.activeFrom}`)
  ]
);

export const questProgress = pgTable(
  "quest_progress",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    questDefinitionId: integer("quest_definition_id").notNull().references(() => questDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    progress: integer("progress").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("quest_progress_customer_definition_unique").on(table.customerId, table.questDefinitionId),
    check("quest_progress_value_check", sql`${table.progress} >= 0`),
    check("quest_progress_status_check", sql`${table.status} IN ('active', 'earned')`)
  ]
);

export const questEvents = pgTable(
  "quest_events",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    questDefinitionId: integer("quest_definition_id").notNull().references(() => questDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceOrderId: integer("source_order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
    eventKey: varchar("event_key", { length: 255 }).notNull().unique(),
    delta: integer("delta").notNull(),
    progressBefore: integer("progress_before").notNull(),
    progressAfter: integer("progress_after").notNull(),
    sourceOrderTotalMinor: bigint("source_order_total_minor", { mode: "number" }).notNull(),
    sourceOrderCurrency: varchar("source_order_currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("quest_events_definition_order_unique").on(table.questDefinitionId, table.sourceOrderId),
    index("quest_events_customer_created_at_idx").on(table.customerId, table.createdAt, table.id),
    check("quest_events_key_not_blank_check", sql`length(btrim(${table.eventKey})) > 0`),
    check("quest_events_delta_check", sql`${table.delta} > 0`),
    check("quest_events_progress_check", sql`${table.progressBefore} >= 0 AND ${table.progressAfter} >= ${table.progressBefore}`),
    check("quest_events_currency_check", sql`${table.sourceOrderCurrency} = 'RUB'`),
    check("quest_events_total_check", sql`${table.sourceOrderTotalMinor} >= 0`)
  ]
);

export const questRewardClaims = pgTable(
  "quest_reward_claims",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    questDefinitionId: integer("quest_definition_id").notNull().references(() => questDefinitions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rewardType: varchar("reward_type", { length: 20 }).notNull(),
    rewardValue: integer("reward_value").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    unique("quest_reward_claims_customer_definition_unique").on(table.customerId, table.questDefinitionId),
    check("quest_reward_claims_type_check", sql`${table.rewardType} IN ('xp', 'coal')`),
    check("quest_reward_claims_value_check", sql`${table.rewardValue} BETWEEN 1 AND 2147483647`),
    check("quest_reward_claims_status_check", sql`${table.status} IN ('pending', 'succeeded', 'reconciliation_required')`),
    check("quest_reward_claims_idempotency_not_blank_check", sql`length(btrim(${table.idempotencyKey})) > 0`)
  ]
);

export type CategoryRecord = typeof categories.$inferSelect;
export type CategoryVersionRecord = typeof categoryVersions.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
export type CustomerRecord = typeof customers.$inferSelect;
export type CustomerSessionRecord = typeof customerSessions.$inferSelect;
export type CustomerNotificationDeviceRecord = typeof customerNotificationDevices.$inferSelect;
export type CustomerNotificationPreferencesRecord = typeof customerNotificationPreferences.$inferSelect;
export type CustomerNotificationDeliveryRecord = typeof customerNotificationDeliveries.$inferSelect;
export type SmsAuthChallengeRecord = typeof smsAuthChallenges.$inferSelect;
export type OrderRecord = typeof orders.$inferSelect;
export type OrderCustomerSnapshotRecord = typeof orderCustomerSnapshots.$inferSelect;
export type OrderItemRecord = typeof orderItems.$inferSelect;
export type OrderStatusHistoryRecord = typeof orderStatusHistory.$inferSelect;
export type OrderIikoItemRecord = typeof orderIikoItems.$inferSelect;
export type IikoOrderDispatchRecord = typeof iikoOrderDispatches.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type PaymentEventRecord = typeof paymentEvents.$inferSelect;
export type StaffUserRecord = typeof staffUsers.$inferSelect;
export type StaffSessionRecord = typeof staffSessions.$inferSelect;
export type StaffAuditLogRecord = typeof staffAuditLog.$inferSelect;
export type OrderCancellationRecord = typeof orderCancellations.$inferSelect;
export type RefundRecord = typeof refunds.$inferSelect;
export type RefundEventRecord = typeof refundEvents.$inferSelect;
export type PromoDefinitionRecord = typeof promoDefinitions.$inferSelect;
export type PromoDefinitionVersionRecord = typeof promoDefinitionVersions.$inferSelect;
export type PromoRedemptionRecord = typeof promoRedemptions.$inferSelect;
export type CommunicationTemplateVersionRecord = typeof communicationTemplateVersions.$inferSelect;
export type CommunicationDraftRecord = typeof communicationDrafts.$inferSelect;
export type CommunicationDraftAuditRecord = typeof communicationDraftAudit.$inferSelect;
export type LoyaltyAccountRecord = typeof loyaltyAccounts.$inferSelect;
export type LoyaltyLedgerRecord = typeof loyaltyLedger.$inferSelect;
export type LoyaltyRankHistoryRecord = typeof loyaltyRankHistory.$inferSelect;
export type LoyaltyRewardRecord = typeof loyaltyRewards.$inferSelect;
export type LoyaltyRewardVersionRecord = typeof loyaltyRewardVersions.$inferSelect;
export type LoyaltyRedemptionRecord = typeof loyaltyRedemptions.$inferSelect;
export type LoyaltyRedemptionOrderRecord = typeof loyaltyRedemptionOrders.$inferSelect;
export type WheelSettingsRecord = typeof wheelSettings.$inferSelect;
export type WheelSettingsVersionRecord = typeof wheelSettingsVersions.$inferSelect;
export type WheelPrizeRecord = typeof wheelPrizes.$inferSelect;
export type WheelPrizeVersionRecord = typeof wheelPrizeVersions.$inferSelect;
export type WheelSpinRecord = typeof wheelSpins.$inferSelect;
export type WheelRewardClaimRecord = typeof wheelRewardClaims.$inferSelect;
export type QuestDefinitionRecord = typeof questDefinitions.$inferSelect;
export type QuestDefinitionVersionRecord = typeof questDefinitionVersions.$inferSelect;
export type QuestProgressRecord = typeof questProgress.$inferSelect;
export type QuestEventRecord = typeof questEvents.$inferSelect;
export type QuestRewardClaimRecord = typeof questRewardClaims.$inferSelect;
