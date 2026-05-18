import { useDashboardStore } from "../store";

/** Returns the top-level dir prefix (mirrors getDirPrefix in GraphView). */
function getTopDirPrefix(activeDirPrefix: string): string {
  const parts = activeDirPrefix.split("/");
  const first = parts[0];
  const CONTAINER = ["src", "lib", "app", "packages", "apps", "source"];
  if (CONTAINER.includes(first) && parts.length > 1) {
    return `${parts[0]}/${parts[1]}`;
  }
  return first;
}

export default function Breadcrumb() {
  const navigationLevel = useDashboardStore((s) => s.navigationLevel);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const activeDirPrefix = useDashboardStore((s) => s.activeDirPrefix);
  const graph = useDashboardStore((s) => s.graph);
  const navigateToOverview = useDashboardStore((s) => s.navigateToOverview);
  const navigateToDirOverview = useDashboardStore((s) => s.navigateToDirOverview);
  const drillIntoDirPrefix = useDashboardStore((s) => s.drillIntoDirPrefix);

  const activeLayer = graph?.layers.find((l) => l.id === activeLayerId);

  // Compute multi-level dir path info
  const topPrefix = activeDirPrefix ? getTopDirPrefix(activeDirPrefix) : null;
  const isDeepDir = activeDirPrefix !== null && topPrefix !== null && activeDirPrefix !== topPrefix;
  const deepLabel = isDeepDir && activeDirPrefix && topPrefix
    ? activeDirPrefix.slice(topPrefix.length + 1)
    : null;

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
      {navigationLevel === "overview" && (
        <div className="px-4 py-2 rounded-full bg-elevated border border-border-subtle text-xs font-semibold tracking-wider uppercase text-text-secondary shadow-lg">
          Project Overview
        </div>
      )}

      {/* Layer only */}
      {navigationLevel === "layer-detail" && activeDirPrefix === null && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-gold/30 text-xs font-semibold tracking-wider uppercase shadow-lg">
          <button onClick={navigateToOverview} className="text-gold hover:text-gold-bright transition-colors">
            Project
          </button>
          <span className="text-text-muted">›</span>
          <span className="text-text-primary">{activeLayer?.name ?? "Layer"}</span>
          <span className="text-text-muted ml-1 text-[10px] normal-case tracking-normal">(Esc to go back)</span>
        </div>
      )}

      {/* One level deep: Project > Layer > src/pages */}
      {navigationLevel === "layer-detail" && activeDirPrefix !== null && !isDeepDir && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-gold/30 text-xs font-semibold tracking-wider uppercase shadow-lg">
          <button onClick={navigateToOverview} className="text-gold hover:text-gold-bright transition-colors">
            Project
          </button>
          <span className="text-text-muted">›</span>
          <button onClick={navigateToDirOverview} className="text-gold hover:text-gold-bright transition-colors">
            {activeLayer?.name ?? "Layer"}
          </button>
          <span className="text-text-muted">›</span>
          <span className="text-text-primary font-mono normal-case tracking-normal">{activeDirPrefix}/</span>
          <span className="text-text-muted ml-1 text-[10px] normal-case tracking-normal">(Esc to go back)</span>
        </div>
      )}

      {/* Two+ levels deep: Project > Layer > src/pages > auth */}
      {navigationLevel === "layer-detail" && activeDirPrefix !== null && isDeepDir && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-elevated border border-gold/30 text-xs font-semibold tracking-wider uppercase shadow-lg">
          <button onClick={navigateToOverview} className="text-gold hover:text-gold-bright transition-colors">
            Project
          </button>
          <span className="text-text-muted">›</span>
          <button onClick={navigateToDirOverview} className="text-gold hover:text-gold-bright transition-colors">
            {activeLayer?.name ?? "Layer"}
          </button>
          <span className="text-text-muted">›</span>
          <button
            onClick={() => drillIntoDirPrefix(topPrefix!)}
            className="text-gold hover:text-gold-bright transition-colors font-mono normal-case tracking-normal"
          >
            {topPrefix}/
          </button>
          <span className="text-text-muted">›</span>
          <span className="text-text-primary font-mono normal-case tracking-normal">{deepLabel}/</span>
          <span className="text-text-muted ml-1 text-[10px] normal-case tracking-normal">(Esc to go back)</span>
        </div>
      )}
    </div>
  );
}
