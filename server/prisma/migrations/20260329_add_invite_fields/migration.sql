ALTER TABLE "users" ADD COLUMN "invite_token" VARCHAR(255) UNIQUE;
ALTER TABLE "users" ADD COLUMN "invite_expires_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "invite_sent_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "password_set" BOOLEAN DEFAULT false;
UPDATE "users" SET "password_set" = true;
