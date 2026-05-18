import { useState, useMemo } from "react";
import { useDashboardStore } from "../store";
import SpecMarkdown from "./SpecMarkdown";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedReq {
  id: string;
  title: string;
  srs: string[];
  inf: string[];
  sch: string[];
  uis: string[];
  tc: string[];
}

interface ImplRef {
  file: string;
  line: number;
  label: string;
}

type CovStatus = "done" | "partial" | "none";

interface ReqCoverage {
  req: ParsedReq;
  srs: CovStatus;
  inf: CovStatus;
  sch: CovStatus;
  uis: CovStatus;
  tc: CovStatus;
  code: CovStatus;
  score: number; // 0–6 count of non-"none"
}

type NavTab = "req" | "queue";

// ─── Coverage helpers ─────────────────────────────────────────────────────────

function covScore(s: CovStatus): number {
  return s === "done" ? 1 : s === "partial" ? 0.5 : 0;
}

function computeCoverage(
  req: ParsedReq,
  infListIds: Set<string>,
  uisListIds: Set<string>,
  schDomains: Set<string>,
  implRefs: ImplRef[] | undefined,
): ReqCoverage {
  const srs: CovStatus =
    req.srs.length > 0 ? "done" : "none";

  const infLinked = req.inf.length > 0;
  const infExists = req.inf.some((id) => infListIds.has(id));
  const inf: CovStatus = !infLinked ? "none" : infExists ? "done" : "partial";

  // SCH: linked explicitly or a domain-level sch exists in reconProgress
  const schLinked = req.sch.length > 0;
  const schDomainHit = req.sch.some((id) => {
    const domain = id.split("-")[0]?.toLowerCase();
    return domain ? schDomains.has(domain) : false;
  });
  const sch: CovStatus = !schLinked ? "none" : schDomainHit ? "done" : "partial";

  const uisLinked = req.uis.length > 0;
  const uisExists = req.uis.some((id) => uisListIds.has(id));
  const uis: CovStatus = !uisLinked ? "none" : uisExists ? "done" : "partial";

  const tc: CovStatus = req.tc.length > 0 ? "done" : "none";

  const code: CovStatus =
    implRefs && implRefs.length > 0 ? "done" : "none";

  const score =
    covScore(srs) +
    covScore(inf) +
    covScore(sch) +
    covScore(uis) +
    covScore(tc) +
    covScore(code);

  return { req, srs, inf, sch, uis, tc, code, score };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DOT_LABELS = ["SRS", "INF", "SCH", "UIS", "TC", "Code"] as const;
type DotLabel = (typeof DOT_LABELS)[number];

function CovDot({ status, label }: { status: CovStatus; label: DotLabel }) {
  const cls =
    status === "done"
      ? "bg-emerald-400"
      : status === "partial"
      ? "bg-yellow-400"
      : "bg-border-subtle";
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls}`}
      title={`${label}: ${status}`}
    />
  );
}

function CovCell({ status }: { status: CovStatus }) {
  if (status === "done") {
    return (
      <td className="px-2 py-2 text-center">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-400/10 text-emerald-400 text-[10px] font-bold">
          ✓
        </span>
      </td>
    );
  }
  if (status === "partial") {
    return (
      <td className="px-2 py-2 text-center">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-yellow-400/10 text-yellow-400 text-[10px] font-bold">
          ~
        </span>
      </td>
    );
  }
  return (
    <td className="px-2 py-2 text-center">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-surface text-text-muted/30 text-[10px]">
        —
      </span>
    </td>
  );
}

// ─── CoverageMatrix ───────────────────────────────────────────────────────────

function CoverageMatrix({
  coverages,
  selectedId,
  onSelect,
}: {
  coverages: ReqCoverage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const cols: DotLabel[] = ["SRS", "INF", "SCH", "UIS", "TC", "Code"];

  // Column-level summary
  const colDone: Record<DotLabel, number> = {} as Record<DotLabel, number>;
  cols.forEach((c) => {
    colDone[c] = coverages.filter(
      (cv) => cv[c.toLowerCase() as keyof ReqCoverage] === "done",
    ).length;
  });

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border-subtle">
          <tr>
            <th className="px-3 py-2 text-left text-text-muted font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">
              REQ-ID
            </th>
            <th className="px-3 py-2 text-left text-text-muted font-semibold uppercase tracking-wider text-[10px] max-w-[200px]">
              요구사항
            </th>
            {cols.map((c) => (
              <th
                key={c}
                className="px-2 py-2 text-center text-text-muted font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
              >
                <div>{c}</div>
                <div className="text-[9px] font-normal text-text-muted/60 mt-0.5">
                  {colDone[c]}/{coverages.length}
                </div>
              </th>
            ))}
            <th className="px-2 py-2 text-center text-text-muted font-semibold uppercase tracking-wider text-[10px]">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {coverages.map((cv) => {
            const pct = Math.round((cv.score / 6) * 100);
            const isSelected = cv.req.id === selectedId;
            return (
              <tr
                key={cv.req.id}
                onClick={() => onSelect(cv.req.id)}
                className={`border-b border-border-subtle cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-indigo-500/10 border-l-2 border-l-indigo-400"
                    : "hover:bg-elevated/60"
                }`}
              >
                <td className="px-3 py-2 font-mono text-indigo-400 whitespace-nowrap text-[11px]">
                  {cv.req.id}
                </td>
                <td className="px-3 py-2 text-text-secondary max-w-[200px] truncate text-[11px]">
                  {cv.req.title || "—"}
                </td>
                <CovCell status={cv.srs} />
                <CovCell status={cv.inf} />
                <CovCell status={cv.sch} />
                <CovCell status={cv.uis} />
                <CovCell status={cv.tc} />
                <CovCell status={cv.code} />
                <td className="px-2 py-2 text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <div className="w-12 h-1.5 bg-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 80
                            ? "bg-emerald-400"
                            : pct >= 50
                            ? "bg-yellow-400"
                            : "bg-red-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono shrink-0 ${
                        pct >= 80
                          ? "text-emerald-400"
                          : pct >= 50
                          ? "text-yellow-400"
                          : "text-red-400"
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── SpecChainView ────────────────────────────────────────────────────────────

const CHAIN_SEGMENTS = [
  {
    key: "srs" as const,
    label: "SRS",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
  },
  {
    key: "inf" as const,
    label: "INF",
    color: "text-teal-400",
    bg: "bg-teal-400/10",
    border: "border-teal-400/30",
  },
  {
    key: "sch" as const,
    label: "SCH",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  {
    key: "uis" as const,
    label: "UIS",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/30",
  },
  {
    key: "tc" as const,
    label: "TC",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
  },
];

function SpecChainView({
  cov,
  implRefs,
}: {
  cov: ReqCoverage;
  implRefs: ImplRef[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["srs", "inf", "uis"]));
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const pct = Math.round((cov.score / 6) * 100);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-3">
      {/* REQ header */}
      <div className="bg-elevated border border-border-subtle rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-indigo-400 text-sm font-semibold mb-1">
              {cov.req.id}
            </div>
            <div className="text-text-primary text-sm leading-relaxed">
              {cov.req.title || "(제목 없음)"}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(["SRS", "INF", "SCH", "UIS", "TC", "Code"] as DotLabel[]).map(
              (lbl) => (
                <div key={lbl} className="flex flex-col items-center gap-0.5">
                  <CovDot
                    status={
                      cov[lbl.toLowerCase() as keyof ReqCoverage] as CovStatus
                    }
                    label={lbl}
                  />
                  <span className="text-[8px] text-text-muted/60">{lbl[0]}</span>
                </div>
              ),
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 h-1 bg-border-subtle rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                pct >= 80 ? "bg-emerald-400" : pct >= 50 ? "bg-yellow-400" : "bg-red-400"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span
            className={`text-[11px] font-mono font-semibold ${
              pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-yellow-400" : "text-red-400"
            }`}
          >
            {pct}%
          </span>
        </div>
      </div>

      {/* Chain segments */}
      {CHAIN_SEGMENTS.map((seg, idx) => {
        const ids = cov.req[seg.key];
        const status = cov[seg.key];
        const isOpen = expanded.has(seg.key);

        return (
          <div key={seg.key} className="relative">
            {idx > 0 && (
              <div className="absolute -top-3 left-6 w-px h-3 bg-border-subtle" />
            )}
            <div
              className={`border ${seg.border} rounded-xl overflow-hidden bg-surface`}
            >
              <button
                type="button"
                onClick={() => toggle(seg.key)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-elevated/40 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    status === "done"
                      ? "bg-emerald-400"
                      : status === "partial"
                      ? "bg-yellow-400"
                      : "bg-border-subtle"
                  }`}
                />
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider w-8 ${seg.color}`}
                >
                  {seg.label}
                </span>
                <span className="flex-1 text-left text-[11px] text-text-muted">
                  {ids.length === 0
                    ? "연결된 항목 없음"
                    : ids.join(", ")}
                </span>
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${seg.bg} ${seg.color}`}
                >
                  {ids.length}
                </span>
                <svg
                  className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && ids.length > 0 && (
                <div className={`${seg.bg} border-t ${seg.border} px-4 py-2 space-y-1`}>
                  {ids.map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-2 py-1"
                    >
                      <span className={`font-mono text-[11px] ${seg.color}`}>{id}</span>
                    </div>
                  ))}
                </div>
              )}

              {isOpen && ids.length === 0 && (
                <div className="px-4 py-3 text-[11px] text-text-muted italic border-t border-border-subtle bg-elevated/30">
                  이 REQ에 연결된 {seg.label} 항목이 없습니다.
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Code implementations */}
      <div className="relative">
        <div className="absolute -top-3 left-6 w-px h-3 bg-border-subtle" />
        <div className="border border-emerald-400/20 rounded-xl overflow-hidden bg-surface">
          <button
            type="button"
            onClick={() => toggle("code")}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-elevated/40 transition-colors"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                implRefs.length > 0 ? "bg-emerald-400" : "bg-border-subtle"
              }`}
            />
            <span className="text-[11px] font-bold uppercase tracking-wider w-8 text-emerald-400">
              Code
            </span>
            <span className="flex-1 text-left text-[11px] text-text-muted">
              {implRefs.length === 0
                ? "linked_req 주석 없음"
                : `${implRefs.length}개 파일에서 구현됨`}
            </span>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">
              {implRefs.length}
            </span>
            <svg
              className={`w-3 h-3 text-text-muted transition-transform ${
                expanded.has("code") ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded.has("code") && implRefs.length > 0 && (
            <div className="bg-emerald-400/5 border-t border-emerald-400/20 divide-y divide-border-subtle">
              {implRefs.map((ref, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-elevated font-mono text-text-muted shrink-0">
                    {ref.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-secondary flex-1 truncate" title={ref.file}>
                    {ref.file.split(/[\\/]/).slice(-2).join("/")}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted shrink-0">
                    :{ref.line}
                  </span>
                </div>
              ))}
            </div>
          )}

          {expanded.has("code") && implRefs.length === 0 && (
            <div className="px-4 py-3 text-[11px] text-text-muted italic border-t border-border-subtle bg-elevated/30">
              소스 파일에서 <code className="font-mono bg-elevated px-1 rounded">linked_req: {"{req-id}"}</code> 주석을 찾을 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AIGenQueue ───────────────────────────────────────────────────────────────

type QueueStatus = "ready" | "done" | "untracked" | "empty";

interface QueueItem {
  req: ParsedReq;
  status: QueueStatus;
  inf: CovStatus;
  code: CovStatus;
}

function AIGenQueue({ coverages }: { coverages: ReqCoverage[] }) {
  const [filter, setFilter] = useState<QueueStatus | "all">("all");

  const items: QueueItem[] = coverages.map((cv) => {
    let status: QueueStatus;
    if (cv.code === "done" && cv.inf === "done") {
      status = "done";
    } else if (cv.inf === "done" && cv.code === "none") {
      status = "ready";
    } else if (cv.code === "done" && cv.inf === "none") {
      status = "untracked";
    } else {
      status = "empty";
    }
    return { req: cv.req, status, inf: cv.inf, code: cv.code };
  });

  const counts = {
    ready: items.filter((i) => i.status === "ready").length,
    done: items.filter((i) => i.status === "done").length,
    untracked: items.filter((i) => i.status === "untracked").length,
    empty: items.filter((i) => i.status === "empty").length,
  };

  const visible =
    filter === "all" ? items : items.filter((i) => i.status === filter);

  const FILTERS: Array<{ key: QueueStatus | "all"; label: string; color: string }> = [
    { key: "all", label: "전체", color: "text-text-secondary" },
    { key: "ready", label: `Ready ${counts.ready}`, color: "text-blue-400" },
    { key: "done", label: `Done ${counts.done}`, color: "text-emerald-400" },
    { key: "untracked", label: `Untracked ${counts.untracked}`, color: "text-yellow-400" },
    { key: "empty", label: `미착수 ${counts.empty}`, color: "text-text-muted" },
  ];

  const STATUS_CONFIG: Record<
    QueueStatus,
    { label: string; bg: string; color: string; desc: string }
  > = {
    ready: {
      label: "Ready",
      bg: "bg-blue-400/10",
      color: "text-blue-400",
      desc: "INF 있음 · 코드 생성 가능",
    },
    done: {
      label: "Done",
      bg: "bg-emerald-400/10",
      color: "text-emerald-400",
      desc: "INF + 코드 모두 완료",
    },
    untracked: {
      label: "Untracked",
      bg: "bg-yellow-400/10",
      color: "text-yellow-400",
      desc: "코드 있음 · INF 없음",
    },
    empty: {
      label: "미착수",
      bg: "bg-surface",
      color: "text-text-muted",
      desc: "설계 없음",
    },
  };

  return (
    <div className="h-full flex flex-col">
      {/* Summary chips */}
      <div className="p-3 flex flex-wrap gap-1.5 border-b border-border-subtle">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
              filter === f.key
                ? "bg-elevated border-border-medium " + f.color
                : "border-transparent text-text-muted hover:text-text-secondary hover:bg-elevated/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
        {visible.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-text-muted">
            항목 없음
          </div>
        )}
        {visible.map((item) => {
          const cfg = STATUS_CONFIG[item.status];
          return (
            <div key={item.req.id} className="flex items-start gap-3 px-4 py-3 hover:bg-elevated/30 transition-colors">
              <span
                className={`shrink-0 mt-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}
              >
                {cfg.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-indigo-400 shrink-0">
                    {item.req.id}
                  </span>
                  <span className="text-[11px] text-text-secondary truncate">
                    {item.req.title}
                  </span>
                </div>
                <div className="text-[9px] text-text-muted mt-0.5">{cfg.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FUNC mode types ──────────────────────────────────────────────────────────

interface FuncEntry {
  id: string;
  description: string;
  srs: string[];
  inf: string[];
  sch: string[];
  uis: string[];
}

interface FuncCoverage {
  func: FuncEntry;
  srs: CovStatus;
  inf: CovStatus;
  sch: CovStatus;
  uis: CovStatus;
  code: CovStatus;
  score: number; // 0–5
}

function computeFuncCoverage(
  func: FuncEntry,
  implRefs: ImplRef[] | undefined,
): FuncCoverage {
  const srs: CovStatus = func.srs.length > 0 ? "done" : "none";
  const inf: CovStatus = func.inf.length > 0 ? "done" : "none";
  const sch: CovStatus = func.sch.length > 0 ? "done" : "none";
  const uis: CovStatus = func.uis.length > 0 ? "done" : "none";
  const code: CovStatus = implRefs && implRefs.length > 0 ? "done" : "none";
  const score = covScore(srs) + covScore(inf) + covScore(sch) + covScore(uis) + covScore(code);
  return { func, srs, inf, sch, uis, code, score };
}

// ─── FuncCoverageMatrix ───────────────────────────────────────────────────────

const FUNC_COLS = ["SRS", "INF", "SCH", "UIS", "Code"] as const;
type FuncCol = (typeof FUNC_COLS)[number];

function FuncCoverageMatrix({
  coverages,
  selectedId,
  onSelect,
}: {
  coverages: FuncCoverage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const colDone: Record<FuncCol, number> = {} as Record<FuncCol, number>;
  FUNC_COLS.forEach((c) => {
    colDone[c] = coverages.filter(
      (cv) => cv[c.toLowerCase() as keyof FuncCoverage] === "done",
    ).length;
  });

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border-subtle">
          <tr>
            <th className="px-3 py-2 text-left text-text-muted font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">
              FUNC-ID
            </th>
            <th className="px-3 py-2 text-left text-text-muted font-semibold uppercase tracking-wider text-[10px] max-w-[200px]">
              기능
            </th>
            {FUNC_COLS.map((c) => (
              <th
                key={c}
                className="px-2 py-2 text-center text-text-muted font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap"
              >
                <div>{c}</div>
                <div className="text-[9px] font-normal text-text-muted/60 mt-0.5">
                  {colDone[c]}/{coverages.length}
                </div>
              </th>
            ))}
            <th className="px-2 py-2 text-center text-text-muted font-semibold uppercase tracking-wider text-[10px]">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {coverages.map((cv) => {
            const pct = Math.round((cv.score / 5) * 100);
            const isSelected = cv.func.id === selectedId;
            return (
              <tr
                key={cv.func.id}
                onClick={() => onSelect(cv.func.id)}
                className={`border-b border-border-subtle cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-amber-500/10 border-l-2 border-l-amber-400"
                    : "hover:bg-elevated/60"
                }`}
              >
                <td className="px-3 py-2 font-mono text-amber-400 whitespace-nowrap text-[11px]">
                  {cv.func.id}
                </td>
                <td className="px-3 py-2 text-text-secondary max-w-[200px] truncate text-[11px]">
                  {cv.func.description || "—"}
                </td>
                <CovCell status={cv.srs} />
                <CovCell status={cv.inf} />
                <CovCell status={cv.sch} />
                <CovCell status={cv.uis} />
                <CovCell status={cv.code} />
                <td className="px-2 py-2 text-center">
                  <div className="flex items-center gap-1 justify-center">
                    <div className="w-12 h-1.5 bg-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 80 ? "bg-emerald-400" : pct >= 50 ? "bg-yellow-400" : "bg-red-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono shrink-0 ${
                        pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-yellow-400" : "text-red-400"
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── FuncChainView ────────────────────────────────────────────────────────────

const FUNC_CHAIN_SEGMENTS = [
  { key: "srs" as const, label: "SRS", color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  { key: "inf" as const, label: "INF", color: "text-teal-400", bg: "bg-teal-400/10", border: "border-teal-400/30" },
  { key: "sch" as const, label: "SCH", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30" },
  { key: "uis" as const, label: "UIS", color: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
];

function FuncChainView({ cov, implRefs }: { cov: FuncCoverage; implRefs: ImplRef[] }) {
  const infList = useDashboardStore((s) => s.infList);
  const uisList = useDashboardStore((s) => s.uisList);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["srs", "inf"]));
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const [specContent, setSpecContent] = useState<string>("");
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const handleSpecClick = (id: string, segKey: string) => {
    if (selectedSpecId === id) { setSelectedSpecId(null); setSpecContent(""); return; }
    const specPath =
      segKey === "inf" ? infList.find((i) => i.infId === id)?.path
      : segKey === "uis" ? uisList.find((u) => u.uisId === id)?.path
      : undefined;
    setSelectedSpecId(id);
    if (!specPath) { setSpecContent("(스펙 파일 경로를 찾을 수 없습니다)"); return; }
    fetch(`/spec-file?path=${encodeURIComponent(specPath)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then(setSpecContent)
      .catch(() => setSpecContent("로드 실패"));
  };

  const pct = Math.round((cov.score / 5) * 100);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-3">
      {/* FUNC header */}
      <div className="bg-elevated border border-border-subtle rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-amber-400 text-sm font-semibold mb-1">
              {cov.func.id}
            </div>
            <div className="text-text-primary text-sm leading-relaxed">
              {cov.func.description || "(설명 없음)"}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(["SRS", "INF", "SCH", "UIS", "Code"] as const).map((lbl) => {
              const key = lbl.toLowerCase() as keyof FuncCoverage;
              return (
                <div key={lbl} className="flex flex-col items-center gap-0.5">
                  <CovDot status={cov[key] as CovStatus} label={lbl as DotLabel} />
                  <span className="text-[8px] text-text-muted/60">{lbl[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 h-1 bg-border-subtle rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                pct >= 80 ? "bg-emerald-400" : pct >= 50 ? "bg-yellow-400" : "bg-red-400"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-[11px] font-mono font-semibold ${
            pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-yellow-400" : "text-red-400"
          }`}>{pct}%</span>
        </div>
      </div>

      {/* Chain segments */}
      {FUNC_CHAIN_SEGMENTS.map((seg, idx) => {
        const ids = cov.func[seg.key];
        const status = cov[seg.key];
        const isOpen = expanded.has(seg.key);

        return (
          <div key={seg.key} className="relative">
            {idx > 0 && (
              <div className="absolute -top-3 left-6 w-px h-3 bg-border-subtle" />
            )}
            <div className={`border ${seg.border} rounded-xl overflow-hidden bg-surface`}>
              <button
                type="button"
                onClick={() => toggle(seg.key)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-elevated/40 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  status === "done" ? "bg-emerald-400" : status === "partial" ? "bg-yellow-400" : "bg-border-subtle"
                }`} />
                <span className={`text-[11px] font-bold uppercase tracking-wider w-8 ${seg.color}`}>
                  {seg.label}
                </span>
                <span className="flex-1 text-left text-[11px] text-text-muted">
                  {ids.length === 0 ? "연결된 항목 없음" : ids.join(", ")}
                </span>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${seg.bg} ${seg.color}`}>
                  {ids.length}
                </span>
                <svg className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && ids.length > 0 && (
                <div className={`${seg.bg} border-t ${seg.border} px-4 py-2 space-y-1`}>
                  {ids.map((id) => {
                    const isSpecSeg = seg.key === "inf" || seg.key === "uis";
                    const isSpecOpen = selectedSpecId === id;
                    return (
                      <div key={id}>
                        <div
                          className={`flex items-center gap-2 py-1 ${isSpecSeg ? "cursor-pointer group" : ""}`}
                          onClick={isSpecSeg ? () => handleSpecClick(id, seg.key) : undefined}
                        >
                          <span className={`font-mono text-[11px] ${seg.color} ${isSpecSeg ? "group-hover:underline" : ""}`}>
                            {id}
                          </span>
                          {isSpecSeg && (
                            <span className="text-[9px] text-text-muted ml-auto">
                              {isSpecOpen ? "▾" : "▸"}
                            </span>
                          )}
                        </div>
                        {isSpecOpen && (
                          <div className="mt-1 mb-2 rounded-lg border border-border-subtle bg-surface overflow-hidden">
                            {specContent
                              ? <SpecMarkdown content={specContent} maxHeight="280px" className="p-3" />
                              : <div className="p-3 text-[11px] text-text-muted">로딩 중…</div>
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {isOpen && ids.length === 0 && (
                <div className="px-4 py-3 text-[11px] text-text-muted italic border-t border-border-subtle bg-elevated/30">
                  이 FUNC에 연결된 {seg.label} 항목이 없습니다.
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Code implementations */}
      <div className="relative">
        <div className="absolute -top-3 left-6 w-px h-3 bg-border-subtle" />
        <div className="border border-emerald-400/20 rounded-xl overflow-hidden bg-surface">
          <button
            type="button"
            onClick={() => toggle("code")}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-elevated/40 transition-colors"
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              implRefs.length > 0 ? "bg-emerald-400" : "bg-border-subtle"
            }`} />
            <span className="text-[11px] font-bold uppercase tracking-wider w-8 text-emerald-400">
              Code
            </span>
            <span className="flex-1 text-left text-[11px] text-text-muted">
              {implRefs.length === 0 ? "linked_func 주석 없음" : `${implRefs.length}개 파일에서 구현됨`}
            </span>
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">
              {implRefs.length}
            </span>
            <svg className={`w-3 h-3 text-text-muted transition-transform ${expanded.has("code") ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expanded.has("code") && implRefs.length > 0 && (
            <div className="bg-emerald-400/5 border-t border-emerald-400/20 divide-y divide-border-subtle">
              {implRefs.map((ref, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-elevated font-mono text-text-muted shrink-0">
                    {ref.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-secondary flex-1 truncate" title={ref.file}>
                    {ref.file.split(/[\\/]/).slice(-2).join("/")}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted shrink-0">:{ref.line}</span>
                </div>
              ))}
            </div>
          )}
          {expanded.has("code") && implRefs.length === 0 && (
            <div className="px-4 py-3 text-[11px] text-text-muted italic border-t border-border-subtle bg-elevated/30">
              소스 파일에서 <code className="font-mono bg-elevated px-1 rounded">linked_func: {"{func-id}"}</code> 주석을 찾을 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FuncSDDPanel (RECON 모드) ────────────────────────────────────────────────

function FuncSDDPanel() {
  const funcMap = useDashboardStore((s) => s.funcMap)!;
  const linkedFuncMap = useDashboardStore((s) => s.linkedFuncMap);

  const [selectedFuncId, setSelectedFuncId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const coverages = useMemo<FuncCoverage[]>(
    () => funcMap.map((f) => computeFuncCoverage(f, linkedFuncMap?.[f.id])),
    [funcMap, linkedFuncMap],
  );

  const filteredCoverages = useMemo(() => {
    if (!search.trim()) return coverages;
    const q = search.toLowerCase();
    return coverages.filter(
      (cv) => cv.func.id.toLowerCase().includes(q) || cv.func.description.toLowerCase().includes(q),
    );
  }, [coverages, search]);

  const selectedCov = useMemo(
    () => coverages.find((cv) => cv.func.id === selectedFuncId) ?? null,
    [coverages, selectedFuncId],
  );
  const selectedImplRefs = useMemo(
    () => (selectedFuncId ? (linkedFuncMap?.[selectedFuncId] ?? []) : []),
    [selectedFuncId, linkedFuncMap],
  );

  const totalCov = coverages.length;
  const fullyDone = coverages.filter((cv) => cv.score === 5).length;
  const overallPct = totalCov > 0 ? Math.round((fullyDone / totalCov) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 bg-root">
      {/* Left navigator */}
      <div className="w-60 shrink-0 flex flex-col border-r border-border-subtle bg-surface">
        <div className="px-3 pt-3 pb-2 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              기능 추적 (RECON)
            </span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] text-emerald-400">{fullyDone}</span>
              <span className="text-[10px] text-text-muted">/{totalCov}</span>
              <span className="font-mono text-[10px] ml-0.5 text-text-muted">({overallPct}%)</span>
            </div>
          </div>
          <div className="w-full h-1 bg-elevated rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                overallPct >= 80 ? "bg-emerald-400" : overallPct >= 50 ? "bg-yellow-400" : "bg-red-400"
              }`}
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b border-border-subtle">
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted/60"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="FUNC 검색..."
              className="w-full pl-6 pr-2 py-1.5 text-[11px] bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
        </div>

        {/* FUNC list */}
        <div className="flex-1 overflow-y-auto">
          {filteredCoverages.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-[11px] text-text-muted">결과 없음</div>
          ) : (
            filteredCoverages.map((cv) => {
              const isSelected = cv.func.id === selectedFuncId;
              return (
                <button
                  key={cv.func.id}
                  type="button"
                  onClick={() => setSelectedFuncId(isSelected ? null : cv.func.id)}
                  className={`w-full text-left px-3 py-2 border-b border-border-subtle transition-colors ${
                    isSelected
                      ? "bg-amber-500/10 border-l-2 border-l-amber-400"
                      : "hover:bg-elevated/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-[10px] text-amber-400 shrink-0">{cv.func.id}</span>
                    <div className="flex items-center gap-0.5">
                      {(["srs", "inf", "sch", "uis", "code"] as const).map((k) => (
                        <span key={k} className={`w-1.5 h-1.5 rounded-full ${
                          cv[k] === "done" ? "bg-emerald-400"
                          : cv[k] === "partial" ? "bg-yellow-400"
                          : "bg-border-subtle"
                        }`} />
                      ))}
                    </div>
                  </div>
                  <div className="text-[10px] text-text-muted truncate">
                    {cv.func.description || "—"}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right main area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {selectedCov ? (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-surface shrink-0">
              <button
                type="button"
                onClick={() => setSelectedFuncId(null)}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Matrix
              </button>
              <span className="text-[11px] text-text-muted">/</span>
              <span className="font-mono text-[11px] text-amber-400">{selectedCov.func.id}</span>
              <span className="text-[11px] text-text-secondary truncate">{selectedCov.func.description}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FuncChainView cov={selectedCov} implRefs={selectedImplRefs} />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface shrink-0">
              <span className="text-[11px] font-medium text-text-secondary">FUNC Coverage Matrix</span>
              <div className="flex-1" />
              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-emerald-400/20 border border-emerald-400/30 flex-shrink-0" />
                  완료
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-surface border border-border-subtle flex-shrink-0" />
                  없음
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FuncCoverageMatrix
                coverages={filteredCoverages}
                selectedId={selectedFuncId}
                onSelect={(id) => setSelectedFuncId(id)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main SDDPanel ─────────────────────────────────────────────────────────────

export default function SDDPanel() {
  const parsedRTM = useDashboardStore((s) => s.parsedRTM);
  const reqImplMap = useDashboardStore((s) => s.reqImplMap);
  const infList = useDashboardStore((s) => s.infList);
  const uisList = useDashboardStore((s) => s.uisList);
  const reconProgress = useDashboardStore((s) => s.reconProgress);
  const funcMap = useDashboardStore((s) => s.funcMap);

  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);
  const [navTab, setNavTab] = useState<NavTab>("req");
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState<"matrix" | "queue">("matrix");

  // Precompute lookup sets
  const infIds = useMemo(
    () => new Set(infList.map((i) => i.infId)),
    [infList],
  );
  const uisIds = useMemo(
    () => new Set(uisList.map((u) => u.uisId)),
    [uisList],
  );
  const schDomains = useMemo(() => {
    const s = new Set<string>();
    (reconProgress ?? []).forEach((rp) => {
      if (rp.schCount > 0) s.add(rp.domain.toLowerCase());
    });
    return s;
  }, [reconProgress]);

  // Compute coverage for all REQs
  const coverages = useMemo<ReqCoverage[]>(() => {
    if (!parsedRTM) return [];
    return parsedRTM.map((req) =>
      computeCoverage(req, infIds, uisIds, schDomains, reqImplMap?.[req.id]),
    );
  }, [parsedRTM, infIds, uisIds, schDomains, reqImplMap]);

  // Filtered list for left nav
  const filteredCoverages = useMemo(() => {
    if (!search.trim()) return coverages;
    const q = search.toLowerCase();
    return coverages.filter(
      (cv) =>
        cv.req.id.toLowerCase().includes(q) ||
        cv.req.title.toLowerCase().includes(q),
    );
  }, [coverages, search]);

  const selectedCov = useMemo(
    () => coverages.find((cv) => cv.req.id === selectedReqId) ?? null,
    [coverages, selectedReqId],
  );
  const selectedImplRefs = useMemo(
    () => (selectedReqId ? (reqImplMap?.[selectedReqId] ?? []) : []),
    [selectedReqId, reqImplMap],
  );

  // Overall stats
  const totalCov = coverages.length;
  const fullyDone = coverages.filter((cv) => cv.score === 6).length;
  const overallPct = totalCov > 0 ? Math.round((fullyDone / totalCov) * 100) : 0;

  // funcMap 있으면 FUNC 우선 (GENESIS·RECON 통일)
  if (funcMap && funcMap.length > 0) {
    return <FuncSDDPanel />;
  }

  // GENESIS + RECON 둘 다 데이터 없음
  if (!parsedRTM || parsedRTM.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
        <div className="w-12 h-12 rounded-xl bg-elevated border border-border-subtle flex items-center justify-center">
          <svg className="w-6 h-6 text-text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-text-secondary mb-1">스펙 데이터 없음</div>
          <div className="text-[11px] text-text-muted">
            GENESIS: /sl-spec → RTM 생성
          </div>
          <div className="text-[11px] text-text-muted mt-1">
            RECON: /sl-recon → FUNC_MAP 생성
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-root">
      {/* ── Left navigator ─────────────────────────────────────── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-border-subtle bg-surface">
        {/* Navigator header */}
        <div className="px-3 pt-3 pb-2 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              요구사항 추적
            </span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] text-emerald-400">{fullyDone}</span>
              <span className="text-[10px] text-text-muted">/</span>
              <span className="font-mono text-[10px] text-text-muted">{totalCov}</span>
              <span className="font-mono text-[10px] ml-0.5 text-text-muted">
                ({overallPct}%)
              </span>
            </div>
          </div>
          {/* Overall progress bar */}
          <div className="w-full h-1 bg-elevated rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all ${
                overallPct >= 80 ? "bg-emerald-400" : overallPct >= 50 ? "bg-yellow-400" : "bg-red-400"
              }`}
              style={{ width: `${overallPct}%` }}
            />
          </div>
          {/* Nav tabs */}
          <div className="flex bg-elevated rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setNavTab("req")}
              className={`flex-1 py-1 text-[10px] font-medium rounded-md transition-colors ${
                navTab === "req"
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              REQ 목록
            </button>
            <button
              type="button"
              onClick={() => setNavTab("queue")}
              className={`flex-1 py-1 text-[10px] font-medium rounded-md transition-colors ${
                navTab === "queue"
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              AI 큐
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b border-border-subtle">
          <div className="relative">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted/60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="REQ 검색..."
              className="w-full pl-6 pr-2 py-1.5 text-[11px] bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
        </div>

        {/* REQ list */}
        <div className="flex-1 overflow-y-auto">
          {navTab === "req" ? (
            filteredCoverages.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-[11px] text-text-muted">
                결과 없음
              </div>
            ) : (
              filteredCoverages.map((cv) => {
                const isSelected = cv.req.id === selectedReqId;
                return (
                  <button
                    key={cv.req.id}
                    type="button"
                    onClick={() =>
                      setSelectedReqId(isSelected ? null : cv.req.id)
                    }
                    className={`w-full text-left px-3 py-2 border-b border-border-subtle transition-colors ${
                      isSelected
                        ? "bg-indigo-500/10 border-l-2 border-l-indigo-400"
                        : "hover:bg-elevated/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono text-[10px] text-indigo-400 shrink-0">
                        {cv.req.id}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {(
                          [
                            { k: "srs", s: cv.srs },
                            { k: "inf", s: cv.inf },
                            { k: "sch", s: cv.sch },
                            { k: "uis", s: cv.uis },
                            { k: "tc", s: cv.tc },
                            { k: "code", s: cv.code },
                          ] as Array<{ k: string; s: CovStatus }>
                        ).map(({ k, s }) => (
                          <span
                            key={k}
                            className={`w-1.5 h-1.5 rounded-full ${
                              s === "done"
                                ? "bg-emerald-400"
                                : s === "partial"
                                ? "bg-yellow-400"
                                : "bg-border-subtle"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {cv.req.title || "—"}
                    </div>
                  </button>
                );
              })
            )
          ) : (
            /* AI queue mini-list in nav */
            filteredCoverages.map((cv) => {
              const hasInf = cv.inf !== "none";
              const hasCode = cv.code === "done";
              const status: QueueStatus =
                hasInf && hasCode
                  ? "done"
                  : hasInf && !hasCode
                  ? "ready"
                  : !hasInf && hasCode
                  ? "untracked"
                  : "empty";

              const dotCls =
                status === "done"
                  ? "bg-emerald-400"
                  : status === "ready"
                  ? "bg-blue-400"
                  : status === "untracked"
                  ? "bg-yellow-400"
                  : "bg-border-subtle";

              const labelCls =
                status === "done"
                  ? "text-emerald-400"
                  : status === "ready"
                  ? "text-blue-400"
                  : status === "untracked"
                  ? "text-yellow-400"
                  : "text-text-muted/50";

              return (
                <button
                  key={cv.req.id}
                  type="button"
                  onClick={() =>
                    setSelectedReqId(cv.req.id === selectedReqId ? null : cv.req.id)
                  }
                  className={`w-full text-left px-3 py-2 border-b border-border-subtle transition-colors ${
                    cv.req.id === selectedReqId
                      ? "bg-indigo-500/10 border-l-2 border-l-indigo-400"
                      : "hover:bg-elevated/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
                    <span className="font-mono text-[10px] text-indigo-400 shrink-0">
                      {cv.req.id}
                    </span>
                    <span className={`text-[9px] font-medium uppercase ${labelCls}`}>
                      {status}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted truncate mt-0.5 pl-3.5">
                    {cv.req.title}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right main area ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {selectedCov ? (
          /* Spec chain view */
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-surface shrink-0">
              <button
                type="button"
                onClick={() => setSelectedReqId(null)}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Matrix
              </button>
              <span className="text-[11px] text-text-muted">/</span>
              <span className="font-mono text-[11px] text-indigo-400">
                {selectedCov.req.id}
              </span>
              <span className="text-[11px] text-text-secondary truncate">
                {selectedCov.req.title}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SpecChainView cov={selectedCov} implRefs={selectedImplRefs} />
            </div>
          </>
        ) : (
          /* Coverage matrix / AI gen queue */
          <>
            <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle bg-surface shrink-0">
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setMainTab("matrix")}
                  className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    mainTab === "matrix"
                      ? "bg-surface text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Coverage Matrix
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab("queue")}
                  className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    mainTab === "queue"
                      ? "bg-surface text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  AI 생성 큐
                </button>
              </div>
              <div className="flex-1" />
              {/* Legend */}
              <div className="flex items-center gap-3 text-[10px] text-text-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-emerald-400/20 border border-emerald-400/30 flex-shrink-0" />
                  완료
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-yellow-400/20 border border-yellow-400/30 flex-shrink-0" />
                  연결만
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-surface border border-border-subtle flex-shrink-0" />
                  없음
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mainTab === "matrix" ? (
                <CoverageMatrix
                  coverages={filteredCoverages}
                  selectedId={selectedReqId}
                  onSelect={(id) => setSelectedReqId(id)}
                />
              ) : (
                <AIGenQueue coverages={filteredCoverages} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
