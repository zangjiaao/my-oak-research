import { json, serverError } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";
import {
  loadBatchTemplates,
  listMissingRequirements,
  sourceIdentityFromSource,
} from "@/lib/source-batch";

export async function GET() {
  try {
    const [identities, sources, credentials] = await Promise.all([
      prisma.sourceIdentity.findMany({
        select: {
          type: true,
          platform: true,
          driver: true,
          intentType: true,
          intentArgsHash: true,
        },
      }),
      prisma.source.findMany({
        select: {
          type: true,
          web: { select: { sourceId: true } },
          darknet: { select: { sourceId: true } },
          search: { select: { sourceId: true, platform: true } },
          social: { select: { sourceId: true, platform: true, config: true } },
        },
      }),
      prisma.credential.findMany({
        select: {
          kind: true,
        },
      }),
    ]);

    const credentialCounts = credentials.reduce<Record<string, number>>(
      (acc: Record<string, number>, item: { kind: string }) => {
        acc[item.kind] = (acc[item.kind] ?? 0) + 1;
        return acc;
      },
      {}
    );

    const scopedIdentitySet = new Set(
      identities.map((identity) =>
        [identity.type, identity.platform, identity.driver, identity.intentType].join("|")
      )
    );

    for (const source of sources) {
      const fallbackIdentity = sourceIdentityFromSource(source);
      if (!fallbackIdentity) continue;
      scopedIdentitySet.add(
        [
          fallbackIdentity.type,
          fallbackIdentity.platform,
          fallbackIdentity.driver,
          fallbackIdentity.intentType,
        ].join("|")
      );
    }

    const templates = await loadBatchTemplates();
    const items = templates.map((template) => {
      const missingRequirements = listMissingRequirements(
        template,
        template.defaultConfig,
        undefined,
        credentialCounts
      );

      const scopedKey = [
        template.type,
        template.platform,
        template.driver,
        template.intent.type,
      ].join("|");

      return {
        key: template.key,
        type: template.type,
        category: template.category,
        platform: template.platform,
        driver: template.driver,
        networkPolicy: template.networkPolicy,
        tags: template.tags,
        intent: template.intent,
        title: template.title,
        description: template.description,
        requiredFields: template.requiredFields,
        credentialRequirements: template.credentialRequirements,
        defaultConfig: template.defaultConfig,
        exists: scopedIdentitySet.has(scopedKey),
        missingRequirements,
      };
    });

    return json({
      total: items.length,
      items,
    });
  } catch (error) {
    return serverError(error);
  }
}
