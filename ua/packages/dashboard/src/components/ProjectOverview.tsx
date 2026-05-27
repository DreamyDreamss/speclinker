import { useMemo, useState } from "react";
import { useDashboardStore } from "../store";

type CovStatus = "done" | "partial" | "none";

function covScore(s: CovStatus): number {
  return s === "done" ? 1 : s === "partial" ? 0.5 : 0;
}

function getFuncStatus(inf: CovStatus, code: CovStatus): "done" | "ready" | "untracked" | "empty" {
  if (code === "done" && inf === "done") return "done";
  if (inf === "done" && code === "none") return "ready";
  if (code === "done" && inf === "none") return "untracked";
  return "empty";
}

function CoverageRing({
  pct,
  size = 80,
  stroke = 7,
  color = "var(--color-accent)",
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const c = size / 2;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-border-subtle)" strokeWidth={stroke} />
      <circle
        cx={c} cy={c} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.7s ease" }}
      />
    </svg>
  );
}

function CommandChip({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg border border-blue-400/20 bg-blue-400/5 hover:bg-blue-400/12 hover:border-blue-400/40 transition-all group"
    >
      <code className="font-mono text-[10px] text-blue-400 flex-1 truncate">{cmd}</code>
      {label && <span className="text-[9px] text-text-muted/60 shrink-0">{label}</span>}
      <span className={`text-[9px] shrink-0 transition-all ${copied ? "text-emerald-400" : "text-text-muted/0 group-hover:text-blue-400/60"}`}>
        {copied ? "✓ 복사됨" : "복사"}
      </span>
    </button>
  );
}

export default function ProjectOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const funcMap = useDashboardStore((s) => s.funcMap);
  const linkedFuncMap = useDashboardStore((s) => s.linkedFuncMap);
  const parsedRTM = useDashboardStore((s) => s.parsedRTM);
  const reqImplMap = useDashboardStore((s) => s.reqImplMap);
  const infList = useDashboardStore((s) => s.infList);
  const uisList = useDashboardStore((s) => s.uisList);
  const srsList = useDashboardStore((s) => s.srsList);
  const reconProgress = useDashboardStore((s) => s.reconProgress);

  const funcCovs = useMemo(() => {
    if (!funcMap) return [];
    return funcMap.map((f) => {
      const refs = linkedFuncMap?.[f.id] ?? [];
      const srs: CovStatus = f.srs.length > 0 ? "done" : "none";
      const inf: CovStatus = f.inf.length > 0 ? "done" : "none";
      const sch: CovStatus = f.sch.length > 0 ? "done" : "none";
      const uis: CovStatus = f.uis.length > 0 ? "done" : "none";
      const code: CovStatus = refs.length > 0 ? "done" : "none";
      const score = covScore(srs) + covScore(inf) + covScore(sch) + covScore(uis) + covScore(code);
      const status = getFuncStatus(inf, code);
      return { id: f.id, description: f.description, srs, inf, sch, uis, code, score, status };
    });
  }, [funcMap, linkedFuncMap]);

  const reqCovs = useMemo(() => {
    if (!parsedRTM) return [];
    return parsedRTM.map((req) => {
      const refs = reqImplMap?.[req.id] ?? [];
      const srs: CovStatus = req.srs.length > 0 ? "done" : "none";
      const inf: CovStatus = req.inf.length > 0 ? "done" : "none";
      const sch: CovStatus = req.sch.length > 0 ? "done" : "none";
      const uis: CovStatus = req.uis.length > 0 ? "done" : "none";
      const tc: CovStatus = req.tc.length > 0 ? "done" : "none";
      const code: CovStatus = refs.length > 0 ? "done" : "none";
      const score = covScore(srs) + covScore(inf) + covScore(sch) + covScore(uis) + covScore(tc) + covScore(code);
      const status = getFuncStatus(inf, code);
      return { id: req.id, description: req.title, srs, inf, sch, uis, code, score, status };
    });
  }, [parsedRTM, reqImplMap]);

  const activeCovs = funcCovs.length > 0 ? funcCovs : reqCovs;
  const mode = funcCovs.length > 0 ? "func" : reqCovs.length > 0 ? "req" : "none";
  const maxScore = mode === "req" ? 6 : 5;

  const total = activeCovs.length;
  const doneItems = activeCovs.filter((c) => c.status === "done");
  const readyItems = activeCovs.filter((c) => c.status === "ready");
  const overallPct =
    total > 0
      ? Math.round((activeCovs.reduce((s, c) => s + c.score, 0) / (total * maxScore)) * 100)
      : 0;

  const artCov = useMemo(() => {
    if (total === 0) return null;
    const pct = (key: "srs" | "inf" | "sch" | "uis" | "code") =>
      Math.round((activeCovs.filter((c) => c[key] === "done").length / total) * 100);
    return {
      srs: pct("srs"),
      inf: pct("inf"),
      sch: pct("sch"),
      uis: pct("uis"),
      code: pct("code"),
    };
  }, [activeCovs, total]);

  const ringColor =
    overallPct >= 80 ? "#34d399" : overallPct >= 50 ? "#fbbf24" : "#f87171";

  if (!graph) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading...</p>
      </div>
    );
  }

  const { project, nodes, edges } = graph;

  // ── No spec data: 온보딩 가이드 ──────────────────────────────────────────
  if (mode === "none") {
    return (
      <div className="h-full overflow-auto p-5 animate-fade-slide-in space-y-5">
        <div>
          <h2 className="font-serif text-xl text-text-primary mb-1">{project.name}</h2>
          {project.description && (
            <p className="text-xs text-text-muted leading-relaxed">{project.description}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Nodes", val: nodes.length },
            { label: "Edges", val: edges.length },
          ].map(({ label, val }) => (
            <div key={label} className="bg-elevated rounded-xl p-3 border border-border-subtle">
              <div className="text-2xl font-mono font-semibold text-accent">{val}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {project.languages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {project.languages.map((l) => (
              <span key={l} className="text-[10px] px-2.5 py-1 rounded-full bg-elevated border border-border-subtle text-text-muted">
                {l}
              </span>
            ))}
          </div>
        )}

        {/* 다음 단계 안내 */}
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3">
          <div className="text-[11px] font-semibold text-accent uppercase tracking-wider">다음 단계</div>
          <div className="text-[11px] text-text-secondary leading-relaxed">
            코드 구조 분석 완료. AIDD를 시작하려면 스펙 생성이 필요합니다.
          </div>
          <div className="space-y-2">
            <CommandChip cmd="/sl-recon" label="기존 코드 → 스펙" />
            <CommandChip cmd="/sl-genesis docs/00_입력자료/interview.md" label="기획 → 설계" />
          </div>
        </div>
      </div>
    );
  }

  // ── AIDD Command Center ───────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto p-4 animate-fade-slide-in space-y-4">
      {/* 헤더 */}
      <div>
        <h2 className="font-serif text-lg text-text-primary leading-tight">{project.name}</h2>
        {project.description && (
          <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{project.description}</p>
        )}
      </div>

      {/* 커버리지 링 + 통계 */}
      <div className="bg-elevated rounded-2xl border border-border-subtle p-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <CoverageRing pct={overallPct} size={72} stroke={6} color={ringColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="text-sm font-mono font-bold"
                style={{ color: ringColor }}
              >
                {overallPct}%
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2.5">
              Overall Coverage
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              {[
                { label: "Total", val: total, color: "text-text-primary" },
                { label: "Done", val: doneItems.length, color: "text-emerald-400" },
                { label: "Ready", val: readyItems.length, color: "text-blue-400" },
              ].map(({ label, val, color }) => (
                <div key={label}>
                  <div className={`text-lg font-mono font-semibold ${color}`}>{val}</div>
                  <div className="text-[9px] text-text-muted uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Artifact Coverage 바 */}
      {artCov && (
        <div className="bg-elevated rounded-xl border border-border-subtle p-3 space-y-2">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Artifact Coverage
          </div>
          {(
            [
              { key: "srs" as const, label: "SRS", barCls: "bg-blue-400" },
              { key: "inf" as const, label: "INF", barCls: "bg-teal-400" },
              { key: "sch" as const, label: "SCH", barCls: "bg-emerald-400" },
              { key: "uis" as const, label: "UIS", barCls: "bg-violet-400" },
              { key: "code" as const, label: "Code", barCls: "bg-green-400" },
            ] as const
          ).map(({ key, label, barCls }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] font-mono w-7 text-text-muted shrink-0">{label}</span>
              <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barCls}`}
                  style={{ width: `${artCov[key]}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-text-muted w-8 text-right shrink-0">
                {artCov[key]}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Ready to Build — AIDD 액션 */}
      {readyItems.length > 0 && (
        <div className="rounded-xl border border-blue-400/25 bg-blue-400/3 p-3 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
              Ready to Build
            </span>
            <span className="text-[9px] text-text-muted ml-auto">클릭 복사</span>
          </div>
          <div className="space-y-1.5">
            {readyItems.slice(0, 4).map((item) => (
              <CommandChip key={item.id} cmd={`/sl-aidd ${item.id}`} label={item.description.slice(0, 24)} />
            ))}
          </div>
          {readyItems.length > 4 && (
            <div className="text-[9px] text-text-muted text-center pt-0.5">
              + {readyItems.length - 4}개 더 (AIDD 탭에서 전체 확인)
            </div>
          )}
        </div>
      )}

      {/* Domain Health */}
      {reconProgress && reconProgress.length > 0 && (
        <div className="bg-elevated rounded-xl border border-border-subtle p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Domain Health
          </div>
          <div className="space-y-1.5">
            {reconProgress.map((dp) => {
              const total = dp.infCount + dp.schCount + dp.uiCount;
              const health = total >= 5 ? "strong" : total >= 2 ? "ok" : "weak";
              const dotCls =
                health === "strong"
                  ? "bg-emerald-400"
                  : health === "ok"
                  ? "bg-yellow-400"
                  : "bg-red-400/70";
              return (
                <div key={dp.domain} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
                  <span className="text-[10px] text-text-secondary flex-1 truncate">{dp.domain}</span>
                  <div className="flex items-center gap-1 text-[9px] font-mono text-text-muted shrink-0">
                    <span className={dp.infCount === 0 ? "text-red-400/60" : "text-teal-400/80"}>
                      {dp.infCount}I
                    </span>
                    <span className="text-text-muted/30">·</span>
                    <span className={dp.schCount === 0 ? "text-red-400/60" : "text-emerald-400/80"}>
                      {dp.schCount}S
                    </span>
                    <span className="text-text-muted/30">·</span>
                    <span className={dp.uiCount === 0 ? "text-red-400/60" : "text-violet-400/80"}>
                      {dp.uiCount}U
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 스펙 문서 카운터 */}
      {(srsList.length > 0 || infList.length > 0 || uisList.length > 0) && (
        <div className="rounded-xl border border-border-subtle p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            스펙 문서
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              { label: "SRS", val: srsList.length, color: "text-blue-400" },
              { label: "INF", val: infList.length, color: "text-teal-400" },
              { label: "UIS", val: uisList.length, color: "text-violet-400" },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-elevated rounded-lg py-2 border border-border-subtle">
                <div className={`text-lg font-mono font-semibold ${color}`}>{val}</div>
                <div className="text-[9px] text-text-muted uppercase">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 코드 그래프 요약 */}
      <div className="rounded-xl border border-border-subtle p-3">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
          코드 그래프
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            {
              label: "파일·모듈",
              val: nodes.filter((n) => ["file", "module", "class"].includes(n.type)).length,
            },
            { label: "의존 관계", val: edges.length },
          ].map(({ label, val }) => (
            <div key={label} className="bg-elevated rounded-lg px-3 py-2 border border-border-subtle">
              <div className="text-base font-mono font-semibold text-accent">{val}</div>
              <div className="text-[10px] text-text-muted">{label}</div>
            </div>
          ))}
        </div>
        {project.languages.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {project.languages.map((l) => (
              <span
                key={l}
                className="text-[10px] px-2 py-0.5 rounded-full bg-elevated border border-border-subtle text-text-muted"
              >
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] text-text-muted text-center pb-1">
        분석: {new Date(project.analyzedAt).toLocaleDateString("ko-KR")}
      </div>
    </div>
  );
}
