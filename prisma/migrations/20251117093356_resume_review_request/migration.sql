-- CreateEnum
CREATE TYPE "ResumeReviewStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ResumeReviewRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "discordId" TEXT,
    "discordUsername" TEXT,
    "attachmentUrl" TEXT NOT NULL,
    "attachmentFilename" TEXT,
    "attachmentContentType" TEXT,
    "attachmentSizeBytes" INTEGER,
    "status" "ResumeReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeReviewRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ResumeReviewRequest" ADD CONSTRAINT "ResumeReviewRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
