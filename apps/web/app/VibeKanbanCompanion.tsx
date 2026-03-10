// apps/web/app/VibeKanbanCompanion.tsx
"use client";
import { VibeKanbanWebCompanion } from "vibe-kanban-web-companion";

export default function VibeKanbanCompanion() {
  if (process.env.NODE_ENV !== "development") return null;
  return <VibeKanbanWebCompanion />;
}