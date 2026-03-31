-- CreateEnum
CREATE TYPE "FeedbackVote" AS ENUM ('UP', 'DOWN', 'NONE');

-- CreateTable
CREATE TABLE "ContentTopicFeedback" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "topicId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "vote" "FeedbackVote" NOT NULL DEFAULT 'NONE',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContentTopicFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentTopicFeedback_contentId_topicId_userId_key" ON "ContentTopicFeedback"("contentId", "topicId", "userId");
CREATE INDEX "ContentTopicFeedback_topicId_userId_idx" ON "ContentTopicFeedback"("topicId", "userId");
CREATE INDEX "ContentTopicFeedback_contentId_idx" ON "ContentTopicFeedback"("contentId");

-- AddForeignKey
ALTER TABLE "ContentTopicFeedback" ADD CONSTRAINT "ContentTopicFeedback_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentTopicFeedback" ADD CONSTRAINT "ContentTopicFeedback_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
