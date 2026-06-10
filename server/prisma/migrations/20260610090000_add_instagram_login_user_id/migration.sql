-- Store the Instagram Login API /me id separately from the webhook recipient id.
-- instagramAccountId remains the Meta Instagram webhook recipient/account id used for routing DMs.

ALTER TABLE "InstagramConnection"
  ADD COLUMN "instagramLoginUserId" TEXT;

CREATE UNIQUE INDEX "InstagramConnection_instagramLoginUserId_key"
  ON "InstagramConnection"("instagramLoginUserId");
