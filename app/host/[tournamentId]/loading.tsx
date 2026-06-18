// Route-level loading UI — shown while the host-board route resolves its async
// params and the client board mounts. Mirrors BoardClient's own loading state
// (centered gold spinner) so the projector never flashes blank during nav.
export default function Loading() {
  return (
    <main className="center-screen">
      <span className="spin" />
    </main>
  );
}
