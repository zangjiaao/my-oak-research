import prisma from "@/lib/prisma";

async function main() {
  const prismaAny = prisma as any;
  const startedAt = Date.now();

  await prismaAny.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`UPDATE "Topic" SET "vector" = NULL`);
    await tx.$executeRawUnsafe(`UPDATE "Content" SET "vector" = NULL`);
    await tx.$executeRawUnsafe(`UPDATE "KnowledgeChunk" SET "embedding" = NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "ContentTopicScore"`);
  });

  const elapsed = Date.now() - startedAt;
  console.log(
    `[reset-embeddings] completed in ${elapsed}ms: cleared Topic.vector, Content.vector, KnowledgeChunk.embedding, ContentTopicScore`
  );
}

main()
  .catch((error) => {
    console.error("[reset-embeddings] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

