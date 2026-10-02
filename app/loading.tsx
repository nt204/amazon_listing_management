export default function Loading() {
  return (
    <main className="flex h-screen w-screen bg-slate-50 text-slate-800" aria-busy="true" aria-label="Đang tải NCE HUB">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="h-9 w-32 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-7 space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-9 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <div className="h-13 border-b border-slate-200 bg-white" />
        <div className="grid h-[calc(100%-3.25rem)] place-items-center p-8">
          <div className="text-center" role="status">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
            <p className="mt-3 text-xs font-bold text-slate-500">Đang tải không gian làm việc…</p>
          </div>
        </div>
      </section>
    </main>
  );
}
