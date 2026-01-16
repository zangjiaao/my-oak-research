import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  const params = await paramsPromise;
  const sessionId = params.id;

  if (!sessionId) {
    return NextResponse.json(
      { success: false, error: "Missing session id" },
      { status: 400 }
    );
  }

  try {
    await prisma.chatMessage.deleteMany({
      where: { sessionId },
    });

    return NextResponse.json({ success: true, message: "History cleared" });
  } catch (error: any) {
    console.error("[clear-chat] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
