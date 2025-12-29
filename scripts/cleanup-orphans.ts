import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('--- Starting Orphan Chunks Cleanup ---')
  
  // 1. Find chunks where fileId is set but the file no longer exists
  const orphans = await prisma.knowledgeChunk.findMany({
    where: {
      fileId: { not: null },
      knowledgeFile: { is: null }
    },
    select: { id: true }
  })
  
  console.log(`Found ${orphans.length} orphan chunks.`)
  
  if (orphans.length > 0) {
    const deleted = await prisma.knowledgeChunk.deleteMany({
      where: {
        id: { in: orphans.map(o => o.id) }
      }
    })
    console.log(`Successfully deleted ${deleted.count} chunks.`)
  }

  // Recalculate or just log current counts
  const counts = await prisma.knowledge.findMany({
    include: {
      _count: {
        select: { knowledgeChunks: true, files: true }
      }
    }
  })
  
  for (const c of counts) {
    console.log(`Knowledge: ${c.name} | Files: ${c._count.files} | Chunks: ${c._count.knowledgeChunks}`)
  }

  console.log('--- Cleanup Finished ---')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
