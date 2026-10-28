import { PhysicalBoard } from "./PhysicalBoard";

export default async function PhysicalTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PhysicalBoard id={id} />;
}
