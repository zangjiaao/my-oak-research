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
    const GATHER_SERVICE_URL = process.env.GATHER_SERVICE_URL || "http://localhost:8000";

    const credential = await prisma.credential.findUnique({
      where: { id },
    });

    if (!credential) {
      return notFound(`Credential ${id} not found`);
    }

    // Step 1: If it's a WhatsApp profile, notify gather service to delete the directory
    if (credential.kind === "whatsapp-profile") {
      try {
        const authData = credential.data as any;
        const profileName = authData?.profileName;

        if (profileName) {
          console.log(`[credentials] Deleting WhatsApp profile: ${profileName} from filesystem...`);
          const response = await fetch(`${GATHER_SERVICE_URL}/delete-profile/${profileName}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.warn(`[credentials] Failed to delete filesystem profile ${profileName}: ${errorText}`);
            // We continue anyway to delete the database record
          }
        }
      } catch (err) {
        console.error("[credentials] Error notifying gather service for profile deletion:", err);
      }
    }

    // Step 2: Delete from database
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
