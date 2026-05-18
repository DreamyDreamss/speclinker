import { useEffect } from "react";
import { useDashboardStore } from "../store";

export default function ReconProgress() {
  const reconProgress = useDashboardStore((s) => s.reconProgress);
  const setReconProgress = useDashboardStore((s) => s.setReconProgress);

  useEffect(() => {
    const load = () =>
      fetch("/api/recon-progress")
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (Array.isArray(data)) setReconProgress(data); })
        .catch(() => {});

    load();

    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string };
        if (msg.type === "file-changed") load();
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [setReconProgress]);

  if (!reconProgress || reconProgress.length === 0) return null;

  const totalInf = reconProgress.reduce((s, d) => s + d.infCount, 0);
  const totalSch = reconProgress.reduce((s, d) => s + d.schCount, 0);
  const totalUi  = reconProgress.reduce((s, d) => s + d.uiCount,  0);

  return (
    <div className="p-4 border-b border-border-subtle">
      {/* Summary */}
      <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
        Recon 진행
      </h3>
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        {[
          { label: "INF", count: totalInf, color: "text-blue-400" },
          { label: "DB",  count: totalSch, color: "text-emerald-400" },
          { label: "UI",  count: totalUi,  color: "text-violet-400" },
        ].map(({ label, count, color }) => (
          <div key={label} className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
            <div className={`text-base font-mono font-semibold ${color}`}>{count}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Per-domain breakdown */}
      <div className="space-y-2.5">
        {reconProgress.map((d) => {
          const hasAny = d.infCount + d.schCount + d.uiCount > 0;
          return (
            <div key={d.domain}>
              <div className="flex items-center justify-between mb-1">
                <span
                  className="text-[10px] font-medium text-text-secondary truncate max-w-[100px]"
                  title={d.domain}
                >
                  {d.domain}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {d.infCount > 0 && <span className="text-[9px] font-mono text-blue-400">{d.infCount}I</span>}
                  {d.schCount > 0 && <span className="text-[9px] font-mono text-emerald-400">{d.schCount}D</span>}
                  {d.uiCount  > 0 && <span className="text-[9px] font-mono text-violet-400">{d.uiCount}U</span>}
                </div>
              </div>
              <div className="flex gap-0.5 h-1">
                <div
                  className={`h-full rounded-sm transition-all ${d.infCount > 0 ? "bg-blue-500" : "bg-border-subtle"}`}
                  style={{ flex: 1 }}
                />
                <div
                  className={`h-full rounded-sm transition-all ${d.schCount > 0 ? "bg-emerald-500" : "bg-border-subtle"}`}
                  style={{ flex: 1 }}
                />
                <div
                  className={`h-full rounded-sm transition-all ${d.uiCount > 0 ? "bg-violet-500" : "bg-border-subtle"}`}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
