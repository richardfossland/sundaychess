// Route-level loading UI — shown during navigation/data fetches so the screen
// never flashes blank. Mirrors the suite's gold-on-ink brand (Suspense
// fallback rendered automatically by the Next.js App Router). Mirrors
// SundayTicTacToe's app/loading.tsx.
export default function Loading() {
  return (
    <main className="center-screen" aria-busy="true">
      <div
        className="stack text-center"
        style={{ alignItems: "center", gap: 18 }}
      >
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <div
          className="spin"
          role="status"
          aria-label="Laster"
          style={{ width: 28, height: 28 }}
        />
        <p className="muted" aria-hidden="true">
          Laster …
        </p>
      </div>
    </main>
  );
}
