import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";
import type { GraphNode } from "@understand-anything/core/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

type InsightTab = "gaps" | "hotspots" | "domains" | "coverage";

interface GapItem {
  id: string;
  description: string;
  hasInf: boolean;
  hasSrs: boolean;
  hasSch: boolean;
  hasUis: boolean;
}

interface HotspotNode {
  id: string;
  name: string;
  filePath?: string;
  summary?: string;
  layer?: string;
  edgeCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pctColor(pct: number) {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-red-400";
}

function barColor(pct: number) {
  if (pct >= 80) return "bg-emerald-400";
  if (pct >= 50) return "bg-yellow-400";
  return "bg-red-400";
}

function MiniBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono ${pctColor(pct)}`}>{pct}%</span>
    </div>
  );
}

// ─── InsightPanel ──────────────────────────────────────────────────────────────

export default function InsightPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const funcMap = useDashboardStore((s) => s.funcMap);
  const linkedFuncMap = useDashboardStore((s) => s.linkedFuncMap);
  const parsedRTM = useDashboardStore((s) => s.parsedRTM);
  const reqImplMap = useDashboardStore((s) => s.reqImplMap);
  const reconProgress = useDashboardStore((s) => s.reconProgress);
  const infList = useDashboardStore((s) => s.infList);
  const srsList = useDashboardStore((s) => s.srsList);
  const uisList = useDashboardStore((s) => s.uisList);

  const [tab, setTab] = useState<InsightTab>("gaps");

  // ── Annotated files (have linked_func or linked_req) ──────────────────────
  const annotatedFiles = useMemo(() => {
    const s = new Set<string>();
    if (linkedFuncMap) Object.values(linkedFuncMap).flat().forEach((r) => s.add(r.file));
    if (reqImplMap) Object.values(reqImplMap).flat().forEach((r) => s.add(r.file));
    return s;
  }, [linkedFuncMap, reqImplMap]);

  // ── Gap items: spec exists but no code annotation ─────────────────────────
  const gapItems = useMemo<GapItem[]>(() => {
    const items: GapItem[] = [];
    if (funcMap) {
      funcMap.forEach((f) => {
        const hasCode = (linkedFuncMap?.[f.id]?.length ?? 0) > 0;
        if (!hasCode && (f.srs.length > 0 || f.inf.length > 0)) {
          items.push({
            id: f.id,
            description: f.description,
            hasInf: f.inf.length > 0,
            hasSrs: f.srs.length > 0,
            hasSch: f.sch.length > 0,
            hasUis: f.uis.length > 0,
          });
        }
      });
    }
    if (parsedRTM) {
      parsedRTM.forEach((req) => {
        const hasCode = (reqImplMap?.[req.id]?.length ?? 0) > 0;
        if (!hasCode && (req.srs.length > 0 || req.inf.length > 0)) {
          items.push({
            id: req.id,
            description: req.title,
            hasInf: req.inf.length > 0,
            hasSrs: req.srs.length > 0,
            hasSch: req.sch.length > 0,
            hasUis: req.uis.length > 0,
          });
        }
      });
    }
    return items;
  }, [funcMap, linkedFuncMap, parsedRTM, reqImplMap]);

  // ── Hotspots: complex nodes without spec annotation ────────────────────────
  const edgeCountMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!graph) return m;
    for (const e of graph.edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [graph]);

  const hotspots = useMemo<HotspotNode[]>(() => {
    if (!graph) return [];
    const candidates = graph.nodes.filter(
      (n: GraphNode) =>
        n.complexity === "complex" &&
        n.filePath &&
        !annotatedFiles.has(n.filePath) &&
        ["file", "class", "module"].includes(n.type),
    );
    return candidates
      .map((n: GraphNode) => ({
        id: n.id,
        name: n.name,
        filePath: n.filePath,
        summary: n.summary,
        layer: graph.layers.find((l) => l.nodeIds.includes(n.id))?.name,
        edgeCount: edgeCountMap.get(n.id) ?? 0,
      }))
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 25);
  }, [graph, annotatedFiles, edgeCountMap]);

  // ── Untracked code: code with no spec ─────────────────────────────────────
  const untrackedCode = useMemo(() => {
    if (!graph || annotatedFiles.size === 0) return [];
    return graph.nodes
      .filter(
        (n: GraphNode) =>
          n.filePath &&
          annotatedFiles.has(n.filePath) &&
          ["file", "class", "module"].includes(n.type),
      )
      .map((n: GraphNode) => ({
        id: n.id,
        name: n.name,
        filePath: n.filePath,
        edgeCount: edgeCountMap.get(n.id) ?? 0,
      }))
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 15);
  }, [graph, annotatedFiles, edgeCountMap]);

  // ── Domain breakdown ──────────────────────────────────────────────────────
  const domainStats = useMemo(() => {
    if (!reconProgress) return [];
    return reconProgress
      .map((dp) => {
        const specTotal = dp.infCount + dp.schCount + dp.uiCount;
        const pct = Math.min(100, Math.round((specTotal / Math.max(1, specTotal + 1)) * 100));
        return { ...dp, specTotal, pct };
      })
      .sort((a, b) => a.specTotal - b.specTotal);
  }, [reconProgress]);

  // ── Coverage summary for coverage tab ─────────────────────────────────────
  const covSummary = useMemo(() => {
    const items = funcMap ?? parsedRTM?.map((r) => ({
      id: r.id,
      srs: r.srs,
      inf: r.inf,
      sch: r.sch,
      uis: r.uis,
    })) ?? [];
    if (items.length === 0) return null;
    const n = items.length;
    const pct = (key: "srs" | "inf" | "sch" | "uis") =>
      Math.round((items.filter((i) => (i as Record<string, unknown>)[key] &&
        ((i as Record<string, unknown>)[key] as unknown[]).length > 0).length / n) * 100);
    const codePct =
      linkedFuncMap || reqImplMap
        ? Math.round(
            (items.filter((i) => {
              const refs = linkedFuncMap?.[i.id] ?? reqImplMap?.[i.id] ?? [];
              return refs.length > 0;
            }).length / n) * 100,
          )
        : 0;
    return {
      total: n,
      srs: pct("srs"),
      inf: pct("inf"),
      sch: pct("sch"),
      uis: pct("uis"),
      code: codePct,
    };
  }, [funcMap, parsedRTM, linkedFuncMap, reqImplMap]);

  // ── Tab config ────────────────────────────────────────────────────────────
  const TABS: Array<{ key: InsightTab; label: string; badge?: number; color: string }> = [
    { key: "gaps",      label: "Gap 분석",      badge: gapItems.length,  color: "text-yellow-400" },
    { key: "hotspots",  label: "Hotspot",        badge: hotspots.length,  color: "text-red-400" },
    { key: "domains",   label: "도메인",          badge: domainStats.filter(d => d.specTotal < 3).length, color: "text-orange-400" },
    { key: "coverage",  label: "커버리지",         badge: undefined,       color: "text-accent" },
  ];

  const noData = gapItems.length === 0 && hotspots.length === 0 && domainStats.length === 0;

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted p-6">
        <div className="w-12 h-12 rounded-xl bg-elevated border border-border-subtle flex items-center justify-center">
          <svg className="w-6 h-6 text-accent/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-text-secondary mb-1">분석 데이터 없음</div>
          <div className="text-[11px] text-text-muted leading-relaxed">
            /sl-recon 실행 후 스펙-소스 인사이트가 표시됩니다
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-root">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-0 border-b border-border-subtle bg-surface shrink-0">
        <h2 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          Spec ↔ Source Insights
        </h2>
        <div className="flex gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.key
                  ? "border-accent text-text-primary bg-elevated/60"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className={`font-mono text-[9px] ${t.color}`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Gap 분석 */}
        {tab === "gaps" && (
          <div>
            <div className="px-4 py-2 text-[10px] text-text-muted bg-elevated/30 border-b border-border-subtle leading-relaxed">
              설계서는 있지만 소스코드에{" "}
              <code className="font-mono bg-elevated px-1 rounded">linked_func</code>{" "}
              주석이 없는 항목 — 코드 생성 또는 주석 추가 필요
            </div>
            {gapItems.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-[11px] text-emerald-400/80">
                모든 스펙에 코드가 연결되어 있습니다
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {gapItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-elevated/30 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-yellow-400/80 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[10px] text-yellow-400 mb-0.5">{item.id}</div>
                      <div className="text-[11px] text-text-secondary truncate">{item.description}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {[
                          { label: "SRS", ok: item.hasSrs, color: "text-blue-400" },
                          { label: "INF", ok: item.hasInf, color: "text-teal-400" },
                          { label: "SCH", ok: item.hasSch, color: "text-emerald-400" },
                          { label: "UIS", ok: item.hasUis, color: "text-violet-400" },
                        ].map(({ label, ok, color }) => (
                          <span
                            key={label}
                            className={`text-[9px] font-mono px-1 py-0.5 rounded border ${
                              ok
                                ? `${color} border-current/30 bg-current/5`
                                : "text-text-muted/30 border-border-subtle/50 bg-transparent"
                            }`}
                            title={ok ? `${label} 존재` : `${label} 없음`}
                          >
                            {ok ? "✓" : "—"} {label}
                          </span>
                        ))}
                        <span className="text-[9px] text-red-400/80 border border-red-400/20 px-1 rounded bg-red-400/5">
                          ✗ Code
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hotspot */}
        {tab === "hotspots" && (
          <div>
            <div className="px-4 py-2 text-[10px] text-text-muted bg-elevated/30 border-b border-border-subtle leading-relaxed">
              <code className="font-mono bg-elevated px-1 rounded">complexity=complex</code>{" "}
              이면서 스펙 주석이 없는 파일 — 문서화 우선순위 높음
            </div>
            {hotspots.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-[11px] text-emerald-400/80">
                복잡한 미주석 파일 없음
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {hotspots.map((node) => (
                  <div key={node.id} className="flex items-start gap-3 px-4 py-3 hover:bg-elevated/30 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-red-400/70 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-medium text-text-primary truncate">{node.name}</span>
                        {node.edgeCount > 0 && (
                          <span className="text-[9px] font-mono text-text-muted shrink-0">
                            {node.edgeCount} edges
                          </span>
                        )}
                      </div>
                      {node.filePath && (
                        <div className="text-[9px] font-mono text-text-muted truncate">
                          {node.filePath.split(/[\\/]/).slice(-3).join("/")}
                        </div>
                      )}
                      {node.layer && (
                        <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-elevated border border-border-subtle text-text-muted">
                          {node.layer}
                        </span>
                      )}
                    </div>
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20 shrink-0 mt-0.5">
                      complex
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Annotated files summary */}
            {untrackedCode.length > 0 && (
              <div className="mt-2 border-t border-border-subtle">
                <div className="px-4 py-2 text-[10px] text-text-muted bg-elevated/30 border-b border-border-subtle">
                  스펙 주석이 있는 파일 (연결됨)
                </div>
                <div className="divide-y divide-border-subtle">
                  {untrackedCode.slice(0, 8).map((node) => (
                    <div key={node.id} className="flex items-center gap-3 px-4 py-2 hover:bg-elevated/20 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                      <span className="text-[10px] text-text-secondary truncate flex-1">{node.name}</span>
                      <span className="text-[9px] font-mono text-text-muted shrink-0">{node.edgeCount}e</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 도메인 건강도 */}
        {tab === "domains" && (
          <div>
            {domainStats.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-[11px] text-text-muted">
                도메인 데이터 없음 — /sl-recon 실행 필요
              </div>
            ) : (
              <>
                <div className="px-4 py-2 text-[10px] text-text-muted bg-elevated/30 border-b border-border-subtle">
                  도메인별 INF·SCH·UIS 스펙 현황 — 약한 도메인이 위에 표시됩니다
                </div>
                <div className="divide-y divide-border-subtle">
                  {domainStats.map((dp) => {
                    const health = dp.specTotal >= 5 ? "strong" : dp.specTotal >= 2 ? "ok" : "weak";
                    const dotCls =
                      health === "strong"
                        ? "bg-emerald-400"
                        : health === "ok"
                        ? "bg-yellow-400"
                        : "bg-red-400/80";
                    return (
                      <div key={dp.domain} className="px-4 py-3 hover:bg-elevated/30 transition-colors">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
                          <span className="text-[11px] font-medium text-text-secondary flex-1">{dp.domain}</span>
                          <span className={`text-[9px] font-mono font-semibold ${
                            health === "strong" ? "text-emerald-400"
                            : health === "ok" ? "text-yellow-400"
                            : "text-red-400"
                          }`}>
                            {dp.specTotal === 0 ? "미착수" : `${dp.specTotal}개`}
                          </span>
                        </div>
                        <div className="flex gap-2 pl-4">
                          {[
                            { label: "INF", val: dp.infCount, color: "text-teal-400", redIfZero: true },
                            { label: "SCH", val: dp.schCount, color: "text-emerald-400", redIfZero: true },
                            { label: "UIS", val: dp.uiCount, color: "text-violet-400", redIfZero: true },
                          ].map(({ label, val, color }) => (
                            <div key={label} className="flex items-center gap-1">
                              <span
                                className={`text-[9px] font-mono font-semibold ${
                                  val === 0 ? "text-red-400/60" : color
                                }`}
                              >
                                {val}
                              </span>
                              <span className="text-[9px] text-text-muted">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* 커버리지 상세 */}
        {tab === "coverage" && (
          <div className="p-4 space-y-4">
            {covSummary ? (
              <>
                <div className="bg-elevated rounded-xl border border-border-subtle p-4 space-y-3">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    전체 커버리지 ({covSummary.total}개 항목)
                  </div>
                  {(
                    [
                      { label: "SRS 기능명세",  key: "srs"  as const, desc: "요구사항 → SRS 매핑" },
                      { label: "INF API명세",   key: "inf"  as const, desc: "API 설계서 존재" },
                      { label: "SCH DB스키마",  key: "sch"  as const, desc: "DB 스키마 매핑" },
                      { label: "UIS 화면설계",  key: "uis"  as const, desc: "화면 설계서 존재" },
                      { label: "Code 구현",     key: "code" as const, desc: "linked_func 주석" },
                    ] as const
                  ).map(({ label, key, desc }) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-[11px] text-text-secondary">{label}</span>
                          <span className="text-[9px] text-text-muted ml-1.5">{desc}</span>
                        </div>
                        <MiniBar pct={covSummary[key]} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* 스펙 문서 전체 카운터 */}
                <div className="bg-elevated rounded-xl border border-border-subtle p-4">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                    생성된 스펙 문서
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "SRS", val: srsList.length, color: "text-blue-400" },
                      { label: "INF", val: infList.length, color: "text-teal-400" },
                      { label: "UIS", val: uisList.length, color: "text-violet-400" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-surface rounded-lg py-2 border border-border-subtle">
                        <div className={`text-xl font-mono font-semibold ${color}`}>{val}</div>
                        <div className="text-[9px] text-text-muted uppercase mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 인사이트 요약 */}
                <div className="rounded-xl border border-border-subtle p-3 space-y-2">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">요약 인사이트</div>
                  {gapItems.length > 0 && (
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1 shrink-0" />
                      <span className="text-text-secondary">
                        <span className="text-yellow-400 font-semibold">{gapItems.length}개</span>{" "}
                        항목이 설계는 있으나 코드 주석 없음 → Gap 탭 확인
                      </span>
                    </div>
                  )}
                  {hotspots.length > 0 && (
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 shrink-0" />
                      <span className="text-text-secondary">
                        <span className="text-red-400 font-semibold">{hotspots.length}개</span>{" "}
                        복잡 파일 → 문서화 우선 필요 (Hotspot 탭)
                      </span>
                    </div>
                  )}
                  {domainStats.filter((d) => d.specTotal === 0).length > 0 && (
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-1 shrink-0" />
                      <span className="text-text-secondary">
                        <span className="text-orange-400 font-semibold">
                          {domainStats.filter((d) => d.specTotal === 0).length}개
                        </span>{" "}
                        도메인이 스펙 0건 → 도메인 탭 확인
                      </span>
                    </div>
                  )}
                  {gapItems.length === 0 && hotspots.length === 0 && (
                    <div className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                      <span className="text-emerald-400/80">감지된 주요 이슈 없음</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-32 text-[11px] text-text-muted">
                스펙 데이터 없음 — /sl-recon 실행 필요
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
