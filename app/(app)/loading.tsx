// Shown instantly on every in-app navigation while the server renders the real
// page. Turns a ~0.5s "frozen" wait into immediate feedback, so the app feels
// snappy even on a slower connection. Covers all routes under (app).
export default function Loading() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-6">
        <div className="h-7 w-52 rounded-lg bg-line" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-line/70" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-(--radius-card) bg-line/60" />
        ))}
      </div>
      <div className="mt-4 h-72 rounded-(--radius-card) bg-line/40" />
    </div>
  );
}
