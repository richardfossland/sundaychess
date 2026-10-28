import type { Metadata } from "next";
import { PublicView } from "./PublicView";

// Offentlig turneringsside for spillere og foresatte. Må ikke indekseres.
export const metadata: Metadata = { title: "Turnering – SundayChess", robots: { index: false, follow: false } };

export default async function PublicTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicView id={id} />;
}
