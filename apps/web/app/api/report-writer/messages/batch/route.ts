import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function DELETE(req: Request) {
  try {
    const { ids } = await req.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid message ids" },
        { status: 400 }
      );
    }

    await prisma.chatMessage.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    return NextResponse.json({ success: true, message: "Messages deleted" });
  } catch (error: any) {
    console.error("[batch-delete-messages] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
