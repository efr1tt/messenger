ALTER TABLE "User" ADD COLUMN "username" TEXT;

UPDATE "User"
SET "username" = LOWER(
  regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9._]', '_', 'g')
) || '_' || right("id", 12)
WHERE "username" IS NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
