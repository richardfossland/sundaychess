import type { Metadata } from "next";
import { ReportView } from "./ReportView";

export const metadata: Metadata = { title: "Meld resultat – SundayChess", robots: { index: false, follow: false } };

export default async function ReportPage({ params }: { params: Promise<{ id: string; round: string; board: string }> }) {
  const { id, round, board } = await params;
  return <ReportView id={id} round={Number(round)} board={Number(board)} />;
}
