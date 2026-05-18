import { useEffect, useState } from "react";
import SpecMarkdown from "./SpecMarkdown";

interface UISItem {
  uisId: string;
  domain: string;
  path: string;
  route?: string;
  entryFile?: string;
  source?: string;
  previewHtmlPath?: string;
  previewPngPath?: string;
}

type ContentTab = "spec" | "preview" | "screenshot";

const SOURCE_BADGE: Record<string, string> = {
  "graph:page":    "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
  "graph:router-edge": "bg-blue-900/40 text-blue-400 border-blue-700/40",
  "fallback:nextjs-app":   "bg-yellow-900/40 text-yellow-500 border-yellow-700/40",
  "fallback:nextjs-pages": "bg-yellow-900/40 text-yellow-500 border-yellow-700/40",
  "fallback:spa":  "bg-orange-900/40 text-orange-400 border-orange-700/40",
  "fallback:jsp":  "bg-orange-900/40 text-orange-400 border-orange-700/40",
};

function sourceBadge(source?: string) {
  if (!source) return null;
  const cls = SOURCE_BADGE[source] ?? "bg-elevated text-text-muted border-border-subtle";
  const label = source.startsWith("graph:") ? "graph" : "fallback";
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

export default function ScreenBrowser() {
  const [items, setItems] = useState<UISItem[]>([]);
  const [selected, setSelected] = useState<UISItem | null>(null);
  const [content, setContent] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ContentTab>("spec");
  const [filter, setFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/uis-list")
      .then((r) => r.ok ? r.json() : [])
      .then((data: UISItem[]) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setContent(""); return; }
    setActiveTab("spec");
    fetch(`/spec-file?path=${encodeURIComponent(selected.path)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then(setContent)
      .catch(() => setContent("로드 실패"));
  }, [selected]);

  const domains = Array.from(new Set(items.map(i => i.domain)));

  const filtered = items.filter((i) => {
    if (domainFilter && i.domain !== domainFilter) return false;
    if (!filter) return true;
    return (
      i.uisId.toLowerCase().includes(filter.toLowerCase()) ||
      i.domain.toLowerCase().includes(filter.toLowerCase()) ||
      (i.route?.toLowerCase().includes(filter.toLowerCase()) ?? false)
    );
  });

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">화면 목록 (UIS)</h2>
          <span className="text-[10px] font-mono text-text-muted">{filtered.length}/{items.length}</span>
        </div>
        <input
          type="text"
          placeholder="화면 검색…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
        />
        {domains.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setDomainFilter(null)}
              className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                !domainFilter ? "border-accent/60 bg-accent/10 text-accent" : "border-border-subtle text-text-muted hover:text-text-secondary"
              }`}
            >
              전체
            </button>
            {domains.map((d) => (
              <button
                key={d}
                onClick={() => setDomainFilter(d === domainFilter ? null : d)}
                className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                  domainFilter === d ? "border-accent/60 bg-accent/10 text-accent" : "border-border-subtle text-text-muted hover:text-text-secondary"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* List */}
        <div className="w-52 shrink-0 border-r border-border-subtle overflow-y-auto py-1">
          {loading && <div className="px-4 py-3 text-xs text-text-muted">로딩 중…</div>}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-text-muted leading-relaxed">
              {items.length === 0 ? "/sl-recon 실행 후 사용 가능합니다" : "검색 결과 없음"}
            </div>
          )}
          {filtered.map((item) => {
            const active = selected?.uisId === item.uisId;
            return (
              <button
                key={item.uisId}
                onClick={() => setSelected(item)}
                className={`w-full text-left px-3 py-2.5 border-b border-border-subtle transition-colors ${
                  active
                    ? "bg-accent/8 border-l-2 border-l-accent"
                    : "hover:bg-elevated"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-mono text-accent font-semibold">{item.uisId}</span>
                  {sourceBadge(item.source)}
                </div>
                <div className="text-[10px] text-text-muted truncate">{item.domain}</div>
                {item.route && (
                  <div className="text-[10px] text-text-muted/50 font-mono truncate">{item.route}</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {selected ? (
            <>
              {/* Header + tabs */}
              <div className="px-4 pt-3 pb-0 border-b border-border-subtle shrink-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono text-accent font-semibold">{selected.uisId}</span>
                  <span className="text-xs text-text-muted">—</span>
                  <span className="text-xs text-text-secondary">{selected.domain}</span>
                  {selected.route && (
                    <span className="text-[10px] font-mono text-text-muted/60 ml-auto">{selected.route}</span>
                  )}
                </div>
                <div className="flex gap-0.5">
                  {(["spec", "preview", "screenshot"] as ContentTab[]).map((tab) => {
                    const disabled = (tab === "preview" && !selected.previewHtmlPath) ||
                                     (tab === "screenshot" && !selected.previewPngPath);
                    return (
                      <button
                        key={tab}
                        type="button"
                        disabled={disabled}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-[10px] font-medium rounded-t-md border border-b-0 transition-colors ${
                          activeTab === tab
                            ? "bg-surface border-border-subtle text-text-primary"
                            : disabled
                            ? "border-transparent text-text-muted/30 cursor-not-allowed"
                            : "border-transparent text-text-muted hover:text-text-secondary hover:bg-elevated/40"
                        }`}
                      >
                        {tab === "spec" ? "Spec" : tab === "preview" ? "Preview" : "Screenshot"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-auto">
                {activeTab === "spec" && (
                  <div className="p-4">
                    {content
                      ? <SpecMarkdown content={content} />
                      : <span className="text-xs text-text-muted">로딩 중…</span>
                    }
                  </div>
                )}
                {activeTab === "preview" && selected.previewHtmlPath && (
                  <iframe
                    src={`/preview?path=${encodeURIComponent(selected.previewHtmlPath)}`}
                    className="w-full h-full border-0"
                    title={`${selected.uisId} preview`}
                  />
                )}
                {activeTab === "screenshot" && selected.previewPngPath && (
                  <div className="p-4 flex justify-center">
                    <img
                      src={`/preview?path=${encodeURIComponent(selected.previewPngPath)}`}
                      alt={`${selected.uisId} screenshot`}
                      className="max-w-full rounded-lg border border-border-subtle"
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-muted">
              좌측에서 화면을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
