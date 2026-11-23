ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;

CREATE INDEX "Session_userId_deviceId_idx" ON "Session"("userId", "deviceId");
