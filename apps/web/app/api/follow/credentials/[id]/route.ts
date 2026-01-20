import { json, serverError, notFound } from "@/app/api/_utils/http";
import prisma from "@/lib/prisma";

/**
 * DELETE /api/follow/credentials/[id]
 * 
 * Delete a specific credential by ID.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const credential = await prisma.credential.findUnique({
      where: { id },
    });

    if (!credential) {
      return notFound(`Credential ${id} not found`);
    }

    await prisma.credential.delete({
      where: { id },
    });

    console.log(`[credentials] Deleted credential: ${id} (${credential.name})`);

    return json({
      success: true,
      message: `Credential "${credential.name}" deleted successfully`,
    });

  } catch (error) {
    console.error("[credentials] Delete error:", error);
    return serverError(error);
  }
}
