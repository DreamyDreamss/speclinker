import { useState, useCallback, useRef, useEffect } from "react";
import { useDashboardStore } from "../store";
import SpecMarkdown from "./SpecMarkdown";

type ViewMode = "domain" | "hierarchy";

interface SpecRef {
  id: string;
  type: "srs" | "inf" | "uis" | "sch";
  path?: string;
  domain?: string;
  label?: string;
}

const TYPE_META = {
  srs: { color: "var(--color-spec-srs)", bg: "rgba(147,197,253,0.14)", border: "rgba(147,197,253,0.35)", label: "SRS", dot: "#93c5fd" },
  inf: { color: "var(--color-spec-inf)", bg: "rgba(45,212,191,0.12)",  border: "rgba(45,212,191,0.3)",  label: "API", dot: "#2dd4bf" },
  uis: { color: "var(--color-spec-uis)", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.3)",  label: "UI",  dot: "#fb923c" },
  sch: { color: "var(--color-spec-sch)", bg: "rgba(74,222,128,0.10)",  border: "rgba(74,222,128,0.28)", label: "DB",  dot: "#4ade80" },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 text-text-muted"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function TypeTag({ type }: { type: SpecRef["type"] }) {
  const m = TYPE_META[type];
  return (
    <span
      className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded shrink-0"
      style={{ color: m.color, background: m.bg, border: `1px solid ${m.border}` }}
    >
      {m.label}
    </span>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-7 pr-7 py-1.5 text-xs bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(""); ref.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CountChip({ value, type }: { value: number; type: SpecRef["type"] }) {
  if (value === 0) return null;
  const m = TYPE_META[type];
  return (
    <span className="text-[9px] font-mono px-1.5 py-px rounded-full" style={{ color: m.color, background: m.bg }}>
      {m.label} {value}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain View
// ─────────────────────────────────────────────────────────────────────────────

function DomainView({ onSelect, selectedId }: { onSelect: (s: SpecRef) => void; selectedId: string | null }) {
  const infList = useDashboardStore((s) => s.infList);
  const uisList = useDashboardStore((s) => s.uisList);
  const srsList = useDashboardStore((s) => s.srsList);

  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const domains = Array.from(
    new Set([...infList.map((i) => i.domain), ...uisList.map((u) => u.domain), ...srsList.map((s) => s.domain)])
  ).filter(Boolean).sort();

  const q = filter.toLowerCase();

  const handleFilterChange = (v: string) => {
    setFilter(v);
    if (v) setOpenDomains(new Set(domains));
  };

  const toggle = (d: string) =>
    setOpenDomains((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const total = { inf: infList.length, uis: uisList.length, srs: srsList.length };

  if (domains.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-elevated flex items-center justify-center">
          <svg className="w-7 h-7 text-text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">스펙 파일 없음</p>
          <p className="text-[10px] text-text-muted/60 leading-relaxed">
            /sl-genesis 또는 /sl-recon 실행 후<br />사용 가능합니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border-subtle bg-elevated/30">
        <CountChip value={total.srs} type="srs" />
        <CountChip value={total.inf} type="inf" />
        <CountChip value={total.uis} type="uis" />
        <span className="text-[9px] text-text-muted/40 ml-auto">{domains.length}개 도메인</span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <SearchInput value={filter} onChange={handleFilterChange} placeholder="스펙 검색…" />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {domains.map((domain) => {
          const dSrs = srsList.filter((s) => s.domain === domain && (!q || s.srsId.toLowerCase().includes(q) || (s.title?.toLowerCase().includes(q) ?? false)));
          const dInf = infList.filter((i) => i.domain === domain && (!q || i.infId.toLowerCase().includes(q)));
          const dUis = uisList.filter((u) => u.domain === domain && (!q || u.uisId.toLowerCase().includes(q) || (u.route?.toLowerCase().includes(q) ?? false)));
          if (q && dSrs.length + dInf.length + dUis.length === 0) return null;
          const open = openDomains.has(domain);

          return (
            <div key={domain} className="border-b border-border-subtle/50 last:border-0">
              {/* Domain header */}
              <button
                type="button"
                onClick={() => toggle(domain)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-elevated/60 transition-colors text-left group"
              >
                <Chevron open={open} />
                <span className="text-xs font-semibold text-text-primary flex-1 group-hover:text-accent transition-colors">
                  {domain}
                </span>
                <div className="flex items-center gap-1 opacity-70">
                  {dSrs.length > 0 && <span className="text-[9px] font-mono" style={{ color: TYPE_META.srs.color }}>S:{dSrs.length}</span>}
                  {dInf.length > 0 && <span className="text-[9px] font-mono" style={{ color: TYPE_META.inf.color }}>A:{dInf.length}</span>}
                  {dUis.length > 0 && <span className="text-[9px] font-mono" style={{ color: TYPE_META.uis.color }}>U:{dUis.length}</span>}
                </div>
              </button>

              {/* Domain children */}
              {open && (
                <div className="pb-2">
                  {dSrs.length > 0 && (
                    <SpecGroup
                      type="srs"
                      items={dSrs.map((s) => ({ id: s.srsId, type: "srs" as const, path: s.path, domain: s.domain, label: s.title }))}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  )}
                  {dInf.length > 0 && (
                    <SpecGroup
                      type="inf"
                      items={dInf.map((i) => ({ id: i.infId, type: "inf" as const, path: i.path, domain: i.domain }))}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  )}
                  {dUis.length > 0 && (
                    <SpecGroup
                      type="uis"
                      items={dUis.map((u) => ({ id: u.uisId, type: "uis" as const, path: u.path, domain: u.domain, label: u.route }))}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpecGroup({ type, items, selectedId, onSelect }: {
  type: SpecRef["type"]; items: SpecRef[]; selectedId: string | null; onSelect: (s: SpecRef) => void;
}) {
  const m = TYPE_META[type];
  return (
    <div className="mx-3 mt-1.5">
      {/* Section label */}
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.dot }} />
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: m.color }}>
          {m.label}
        </span>
        <span className="text-[9px] text-text-muted/40 ml-auto">{items.length}</span>
      </div>

      {/* Items */}
      <div className="rounded-lg overflow-hidden border border-border-subtle/40">
        {items.map((item, idx) => {
          const active = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-all ${
                idx > 0 ? "border-t border-border-subtle/30" : ""
              } ${
                active
                  ? "text-text-primary"
                  : "hover:bg-elevated/60 text-text-secondary hover:text-text-primary"
              }`}
              style={active ? { background: m.bg, borderLeft: `2px solid ${m.dot}` } : {}}
            >
              <span className="text-[10px] font-mono font-semibold shrink-0" style={{ color: active ? m.color : m.dot + "bb" }}>
                {item.id}
              </span>
              {item.label && (
                <span className="text-[10px] text-text-muted truncate">{item.label}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy View
// ─────────────────────────────────────────────────────────────────────────────

function HierarchyView({ onSelect, selectedId }: { onSelect: (s: SpecRef) => void; selectedId: string | null }) {
  const parsedRTM = useDashboardStore((s) => s.parsedRTM);
  const funcMap   = useDashboardStore((s) => s.funcMap);
  const infList   = useDashboardStore((s) => s.infList);
  const uisList   = useDashboardStore((s) => s.uisList);
  const srsList   = useDashboardStore((s) => s.srsList);

  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const resolveInf = (id: string) => infList.find((i) => i.infId === id)?.path;
  const resolveUis = (id: string) => uisList.find((u) => u.uisId === id)?.path;
  const resolveSrs = (id: string) => srsList.find((s) => s.srsId === id)?.path;

  const toggle = (id: string) =>
    setOpenRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!parsedRTM && !funcMap) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-elevated flex items-center justify-center">
          <svg className="w-7 h-7 text-text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h8m-8 4h4" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1">추적 데이터 없음</p>
          <p className="text-[10px] text-text-muted/60 leading-relaxed">
            GENESIS: RTM_v1.0.md<br />RECON: FUNC_MAP.md 필요
          </p>
        </div>
      </div>
    );
  }

  const isGenesis = !!parsedRTM;
  const q = filter.toLowerCase();

  const rows = isGenesis
    ? (parsedRTM ?? []).filter((r) => !q || r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
    : (funcMap ?? []).filter((r) => !q || r.id.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));

  const parentColor = isGenesis ? "var(--color-spec-req)" : "var(--color-spec-func)";
  const parentBg    = isGenesis ? "rgba(167,139,250,0.12)" : "rgba(251,191,36,0.12)";
  const parentBorder = isGenesis ? "rgba(167,139,250,0.3)" : "rgba(251,191,36,0.3)";

  const handleFilterChange = (v: string) => {
    setFilter(v);
    if (v) setOpenRows(new Set(rows.map((r) => r.id)));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode indicator */}
      <div className="px-3 py-1.5 border-b border-border-subtle bg-elevated/30 flex items-center gap-2">
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded"
          style={{ color: parentColor, background: parentBg, border: `1px solid ${parentBorder}` }}
        >
          {isGenesis ? "REQ" : "FUNC"}
        </span>
        <span className="text-[9px] text-text-muted/60">→ SRS / INF / SCH / UIS 체인</span>
        <span className="text-[9px] font-mono text-text-muted/40 ml-auto">{rows.length}건</span>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <SearchInput
          value={filter}
          onChange={handleFilterChange}
          placeholder={isGenesis ? "REQ-ID 또는 요구사항명 검색…" : "FUNC-ID 또는 설명 검색…"}
        />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.map((row) => {
          const open = openRows.has(row.id);
          const srsIds = row.srs;
          const infIds = row.inf;
          const schIds = row.sch;
          const uisIds = row.uis;
          const hasLinks = srsIds.length + infIds.length + schIds.length + uisIds.length > 0;
          const title = isGenesis
            ? (row as { title: string }).title
            : (row as { description: string }).description;

          return (
            <div key={row.id} className="border-b border-border-subtle/50 last:border-0">
              <button
                type="button"
                onClick={() => toggle(row.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-elevated/60 transition-colors text-left group"
              >
                <Chevron open={open} />
                <span
                  className="text-[10px] font-mono shrink-0 px-1.5 py-px rounded"
                  style={{ color: parentColor, background: parentBg, border: `1px solid ${parentBorder}` }}
                >
                  {row.id}
                </span>
                <span className="text-xs text-text-secondary truncate flex-1 group-hover:text-text-primary transition-colors">
                  {title}
                </span>
                {!hasLinks && <span className="text-[9px] text-text-muted/30 shrink-0">—</span>}
                {hasLinks && !open && (
                  <span className="text-[9px] text-text-muted/50 shrink-0">
                    {srsIds.length + infIds.length + schIds.length + uisIds.length}개
                  </span>
                )}
              </button>

              {open && hasLinks && (
                <div className="px-4 pt-1.5 pb-3 bg-elevated/20 border-t border-border-subtle/30">
                  <div className="flex flex-wrap gap-1.5">
                    {srsIds.map((id) => (
                      <HierBadge key={id} id={id} type="srs" path={resolveSrs(id)} selectedId={selectedId} onSelect={onSelect} />
                    ))}
                    {infIds.map((id) => (
                      <HierBadge key={id} id={id} type="inf" path={resolveInf(id)} selectedId={selectedId} onSelect={onSelect} />
                    ))}
                    {schIds.map((id) => (
                      <HierBadge key={id} id={id} type="sch" path={undefined} selectedId={selectedId} onSelect={onSelect} />
                    ))}
                    {uisIds.map((id) => (
                      <HierBadge key={id} id={id} type="uis" path={resolveUis(id)} selectedId={selectedId} onSelect={onSelect} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {rows.length === 0 && q && (
          <div className="px-4 py-6 text-xs text-text-muted text-center">검색 결과 없음</div>
        )}
      </div>
    </div>
  );
}

function HierBadge({ id, type, path, selectedId, onSelect }: {
  id: string; type: SpecRef["type"]; path?: string; selectedId: string | null;
  onSelect: (s: SpecRef) => void;
}) {
  const m = TYPE_META[type];
  const active = selectedId === id;
  const clickable = !!path;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelect({ id, type, path })}
      title={clickable ? path : `${id} (스펙 파일 없음)`}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-all border ${
        active
          ? "ring-1 ring-offset-1 ring-offset-elevated"
          : clickable
          ? "hover:brightness-125 hover:shadow-sm"
          : "opacity-35 cursor-default"
      }`}
      style={{
        color: m.color,
        background: m.bg,
        borderColor: active ? m.dot : m.border,
        outlineColor: active ? m.dot : undefined,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: m.dot, opacity: active ? 1 : 0.7 }}
      />
      {id}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Panel
// ─────────────────────────────────────────────────────────────────────────────

function ContentPanel({ selected, content, loading }: {
  selected: SpecRef | null; content: string; loading: boolean;
}) {
  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted select-none">
        <div className="w-16 h-16 rounded-2xl bg-elevated/60 border border-border-subtle flex items-center justify-center">
          <svg className="w-8 h-8 opacity-25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-secondary">스펙 문서</p>
          <p className="text-xs text-text-muted/60 mt-1">좌측에서 항목을 선택하세요</p>
        </div>
        <div className="flex gap-3 text-[10px] text-text-muted/40 mt-2">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_META.srs.dot }} />SRS
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_META.inf.dot }} />INF
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_META.uis.dot }} />UIS
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_META.sch.dot }} />SCH
          </span>
        </div>
      </div>
    );
  }

  const m = TYPE_META[selected.type];

  return (
    <div className="flex flex-col h-full">
      {/* Content header */}
      <div
        className="px-5 py-3 border-b border-border-subtle shrink-0 flex items-center gap-3"
        style={{ borderBottomColor: m.border, background: m.bg + "40" }}
      >
        <TypeTag type={selected.type} />
        <span className="text-sm font-mono font-semibold" style={{ color: m.color }}>
          {selected.id}
        </span>
        {selected.domain && (
          <>
            <span className="text-text-muted/40">/</span>
            <span className="text-xs text-text-muted">{selected.domain}</span>
          </>
        )}
        {selected.label && (
          <>
            <span className="text-text-muted/40">/</span>
            <span className="text-xs text-text-secondary truncate max-w-xs">{selected.label}</span>
          </>
        )}
        {selected.path && (
          <span className="text-[10px] font-mono text-text-muted/40 ml-auto truncate max-w-[240px]" title={selected.path}>
            {selected.path.split("/").slice(-2).join("/")}
          </span>
        )}
      </div>

      {/* Content body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              로딩 중…
            </div>
          </div>
        ) : content ? (
          <div className="px-6 py-5 max-w-4xl">
            <SpecMarkdown content={content} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-xs text-text-muted">
            파일을 찾을 수 없습니다
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export default function SpecExplorer() {
  const [viewMode, setViewMode] = useState<ViewMode>("domain");
  const [selected, setSelected] = useState<SpecRef | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Reset selected when switching view modes
  const prevMode = useRef(viewMode);
  useEffect(() => {
    if (prevMode.current !== viewMode) {
      setSelected(null);
      setContent("");
      prevMode.current = viewMode;
    }
  }, [viewMode]);

  const handleSelect = useCallback((spec: SpecRef) => {
    if (!spec.path) return;
    // Toggle off on re-click
    if (selected?.id === spec.id) { setSelected(null); setContent(""); return; }
    setSelected(spec);
    setLoading(true);
    fetch(`/spec-file?path=${encodeURIComponent(spec.path)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then((text) => { setContent(text); setLoading(false); })
      .catch(() => { setContent("로드 실패"); setLoading(false); });
  }, [selected]);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--color-bg-root)" }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-surface shrink-0">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">스펙 탐색기</h2>

        {/* View toggle */}
        <div className="flex items-center bg-elevated rounded-lg p-0.5 gap-0.5 ml-1">
          {([
            { mode: "domain",    label: "도메인",  icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
            { mode: "hierarchy", label: "계층",    icon: "M4 6h16M4 10h16M4 14h8m-8 4h4" },
          ] as const).map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-md transition-all ${
                viewMode === mode
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* Selected breadcrumb */}
        {selected && (
          <div className="flex items-center gap-2 ml-auto">
            <TypeTag type={selected.type} />
            <span className="text-[10px] font-mono" style={{ color: TYPE_META[selected.type].color }}>
              {selected.id}
            </span>
            <button
              type="button"
              onClick={() => { setSelected(null); setContent(""); }}
              className="w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left nav */}
        <div
          className="w-72 shrink-0 border-r border-border-subtle overflow-hidden flex flex-col"
          style={{ background: "var(--color-bg-surface)" }}
        >
          {viewMode === "domain"
            ? <DomainView onSelect={handleSelect} selectedId={selected?.id ?? null} />
            : <HierarchyView onSelect={handleSelect} selectedId={selected?.id ?? null} />
          }
        </div>

        {/* Right content */}
        <div className="flex-1 min-h-0 overflow-hidden bg-root">
          <ContentPanel selected={selected} content={content} loading={loading} />
        </div>
      </div>
    </div>
  );
}
