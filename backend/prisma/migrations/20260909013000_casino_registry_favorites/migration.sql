-- CreateTable
CREATE TABLE "CasinoGameFavorite" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoGameFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasinoGameFavorite_userId_gameId_key" ON "CasinoGameFavorite"("userId", "gameId");

-- CreateIndex
CREATE INDEX "CasinoGameFavorite_userId_createdAt_idx" ON "CasinoGameFavorite"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CasinoGameFavorite" ADD CONSTRAINT "CasinoGameFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
