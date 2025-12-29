import { PrismaClient } from '../app/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  console.log('--- 正在开始清理“孤儿切片”（无关联文件的切片） ---')

  // 1. 查找那些 fileId 不为空，但关联的 KnowledgeFile 已经不存在的切片
  const orphans = await prisma.knowledgeChunk.findMany({
    where: {
      fileId: { not: null },
      file: { is: null }
    },
    select: { id: true }
  })

  console.log(`发现 ${orphans.length} 个孤立切片。`)

  if (orphans.length > 0) {
    const deleted = await prisma.knowledgeChunk.deleteMany({
      where: {
        id: { in: orphans.map(o => o.id) }
      }
    })
    console.log(`成功清理了 ${deleted.count} 个切片记录。`)
  }

  // 2. 统计并输出当前各知识库的状态，确认清理结果
  const counts = await prisma.knowledge.findMany({
    include: {
      _count: {
        select: { knowledgeChunks: true, files: true }
      }
    }
  })

  console.log('\n--- 当前知识库统计 ---')
  for (const c of counts) {
    console.log(`知识库: ${c.name} | 现有文件: ${c._count.files} | 现有切片: ${c._count.knowledgeChunks}`)
  }

  console.log('\n--- 清理完成 ---')
}

main()
  .catch(e => {
    console.error('清理过程中发生错误:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
