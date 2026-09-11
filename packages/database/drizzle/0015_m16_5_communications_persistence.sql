CREATE TABLE "communication_template_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"code" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"icon" varchar(4) NOT NULL,
	"title" varchar(80) NOT NULL,
	"body" text NOT NULL,
	"variables" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_template_versions_code_version_unique" UNIQUE("code", "version"),
	CONSTRAINT "communication_template_versions_code_format_check" CHECK ("code" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "communication_template_versions_version_check" CHECK ("version" > 0),
	CONSTRAINT "communication_template_versions_title_not_blank_check" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "communication_template_versions_body_length_check" CHECK (length(btrim("body")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
INSERT INTO "communication_template_versions" ("code", "version", "icon", "title", "body", "variables") VALUES
	('promo', 1, '🎁', 'Промо-акция', '🔥 {name}, для тебя есть специальное предложение. Открой приложение, чтобы узнать условия акции.', ARRAY['name']::text[]),
	('winback', 1, '💔', 'Вернуть клиента', '💔 {name}, мы скучаем по тебе! Возвращайся в приложение — будем рады видеть.', ARRAY['name']::text[]),
	('thankyou', 1, '🙏', 'Благодарность', '🙏 {name}, спасибо, что выбираешь «Все Про Жар»! Ждём тебя снова.', ARRAY['name']::text[]),
	('birthday', 1, '🎂', 'День рождения', '🎂 {name}, поздравляем! Открой приложение, чтобы посмотреть персональное предложение.', ARRAY['name']::text[]),
	('newdish', 1, '🆕', 'Новинка в меню', '🆕 {name}, в меню «Все Про Жар» появилась новинка. Открой приложение и попробуй её 🔥', ARRAY['name']::text[]),
	('coal', 1, '🔥', 'Напоминание об угольках', '🔥 {name}, твои подтверждённые угольки ждут тебя в приложении.', ARRAY['name']::text[]);
--> statement-breakpoint
CREATE TABLE "communication_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"template_code" varchar(32) NOT NULL,
	"template_version" integer NOT NULL,
	"template_title" varchar(80) NOT NULL,
	"body" text NOT NULL,
	"channel" varchar(8) NOT NULL,
	"delay_seconds" integer DEFAULT 0 NOT NULL,
	"segment_code" varchar(40) NOT NULL,
	"segment_definition_id" varchar(80) NOT NULL,
	"segment_definition_version" integer NOT NULL,
	"preview_count" integer,
	"preview_generated_at" timestamp with time zone,
	"preview_segment_as_of" timestamp with time zone,
	"promo_definition_id" integer,
	"promo_definition_version" integer,
	"promo_code" varchar(32),
	"promo_type" varchar(16),
	"promo_value" integer,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_by_staff_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "communication_drafts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "communication_drafts_template_version_fk" FOREIGN KEY ("template_code", "template_version") REFERENCES "public"."communication_template_versions"("code", "version") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "communication_drafts_promo_definition_id_promo_definitions_id_fk" FOREIGN KEY ("promo_definition_id") REFERENCES "public"."promo_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "communication_drafts_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "communication_drafts_idempotency_key_not_blank_check" CHECK (length(btrim("idempotency_key")) > 0),
	CONSTRAINT "communication_drafts_payload_fingerprint_check" CHECK ("payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "communication_drafts_body_length_check" CHECK (length(btrim("body")) BETWEEN 1 AND 2000),
	CONSTRAINT "communication_drafts_channel_check" CHECK ("channel" IN ('push', 'sms')),
	CONSTRAINT "communication_drafts_delay_seconds_check" CHECK ("delay_seconds" BETWEEN 0 AND 86400),
	CONSTRAINT "communication_drafts_segment_definition_version_check" CHECK ("segment_definition_version" > 0),
	CONSTRAINT "communication_drafts_status_check" CHECK ("status" IN ('draft', 'previewed', 'archived')),
	CONSTRAINT "communication_drafts_version_check" CHECK ("version" > 0),
	CONSTRAINT "communication_drafts_archive_state_check" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL)),
	CONSTRAINT "communication_drafts_preview_metadata_check" CHECK ((("preview_count" IS NULL AND "preview_generated_at" IS NULL AND "preview_segment_as_of" IS NULL) OR ("preview_count" IS NOT NULL AND "preview_count" >= 0 AND "preview_generated_at" IS NOT NULL AND "preview_segment_as_of" IS NOT NULL)) AND ("status" <> 'previewed' OR ("preview_count" IS NOT NULL AND "preview_generated_at" IS NOT NULL AND "preview_segment_as_of" IS NOT NULL))),
	CONSTRAINT "communication_drafts_promo_snapshot_check" CHECK (("promo_definition_id" IS NULL AND "promo_definition_version" IS NULL AND "promo_code" IS NULL AND "promo_type" IS NULL AND "promo_value" IS NULL) OR ("promo_definition_id" IS NOT NULL AND "promo_definition_version" IS NOT NULL AND "promo_definition_version" > 0 AND "promo_code" IS NOT NULL AND "promo_type" IN ('percent', 'fixed') AND "promo_value" IS NOT NULL AND "promo_value" > 0))
);
--> statement-breakpoint
CREATE INDEX "communication_drafts_status_updated_at_idx" ON "communication_drafts" USING btree ("status", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX "communication_drafts_segment_code_idx" ON "communication_drafts" USING btree ("segment_code");
--> statement-breakpoint
CREATE INDEX "communication_drafts_created_by_staff_user_id_idx" ON "communication_drafts" USING btree ("created_by_staff_user_id");
--> statement-breakpoint
CREATE TABLE "communication_draft_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"draft_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16) NOT NULL,
	"actor_staff_user_id" integer NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_draft_audit_draft_id_communication_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."communication_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "communication_draft_audit_actor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT "communication_draft_audit_action_check" CHECK ("action" IN ('created', 'updated', 'previewed', 'archived', 'restored')),
	CONSTRAINT "communication_draft_audit_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('draft', 'previewed', 'archived')),
	CONSTRAINT "communication_draft_audit_to_status_check" CHECK ("to_status" IN ('draft', 'previewed', 'archived')),
	CONSTRAINT "communication_draft_audit_version_check" CHECK ("version" > 0),
	CONSTRAINT "communication_draft_audit_transition_check" CHECK (("action" = 'created' AND "from_status" IS NULL AND "to_status" = 'draft' AND "version" = 1) OR ("action" <> 'created' AND "from_status" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "communication_draft_audit_draft_created_at_idx" ON "communication_draft_audit" USING btree ("draft_id", "created_at", "id");
