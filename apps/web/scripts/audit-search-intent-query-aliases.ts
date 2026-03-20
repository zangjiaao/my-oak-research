import prisma from "@/lib/prisma";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function main() {
  const sources = await prisma.source.findMany({
    where: {
      type: "SOCIAL_MEDIA",
      social: {
        isNot: null,
      },
    },
    include: {
      social: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const rows = sources
    .map((source) => {
      const config = asObject(source.social?.config);
      const intent = asObject(config.intent);
      const args = asObject(intent.args);
      const intentType =
        typeof intent.type === "string" ? intent.type.trim().toLowerCase() : "";
      if (intentType !== "search") return null;

      const hasQuery = typeof args.query === "string" && args.query.trim().length > 0;
      const hasKeyword =
        typeof args.keyword === "string" && args.keyword.trim().length > 0;
      if (!hasKeyword || hasQuery) return null;

      return {
        sourceId: source.id,
        sourceName: source.name,
        platform: source.social?.platform ?? "unknown",
        intentType,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          message: "no legacy search aliases found",
          count: 0,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        message: "legacy search aliases detected; migrate keyword -> query",
        count: rows.length,
        items: rows,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          message: "audit failed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
