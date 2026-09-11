ALTER TABLE "staff_users" DROP CONSTRAINT IF EXISTS "staff_users_role_check";
--> statement-breakpoint
ALTER TABLE "staff_users" DROP COLUMN IF EXISTS "role";
