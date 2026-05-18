import { useEffect, useState } from "react";

interface INFItem {
  infId: string;
  domain: string;
  path: string;
}

const METHOD_CLS: Record<string, string> = {
  GET:    "bg-blue-900/40 text-blue-400 border-blue-700/40",
  POST:   "bg-green-900/40 text-green-400 border-green-700/40",
  PUT:    "bg-yellow-900/40 text-yellow-400 border-yellow-700/40",
  PATCH:  "bg-orange-900/40 text-orange-400 border-orange-700/40",
  DELETE: "bg-red-900/40 text-red-400 border-red-700/40",
};

function parseEndpoint(content: string): { method: string; path: string } | null {
  const m = content.match(/##?\s+(GET|POST|PUT|PATCH|DELETE)\s+(`([^`]+)`|(\S+))/i);
  if (!m) return null;
  return { method: m[1].toUpperCase(), path: (m[3] ?? m[4] ?? "").replace(/`/g, "") };
}

export default function APIExplorer() {
  const [items, setItems] = useState<INFItem[]>([]);
  const [selected, setSelected] = useState<INFItem | null>(null);
  const [content, setContent] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endpoints, setEndpoints] = useState<Record<string, { method: string; path: string } | null>>({});

  useEffect(() => {
    fetch("/api/inf-list")
      .then((r) => r.ok ? r.json() : [])
      .then((data: INFItem[]) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setContent(""); return; }
    fetch(`/spec-file?path=${encodeURIComponent(selected.path)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then((text) => {
        setContent(text);
        setEndpoints((prev) => ({ ...prev, [selected.infId]: parseEndpoint(text) }));
      })
      .catch(() => setContent("로드 실패"));
  }, [selected]);

  const domains = Array.from(new Set(items.map((i) => i.domain)));
  const filtered = items.filter((i) => {
    if (domainFilter && i.domain !== domainFilter) return false;
    if (!filter) return true;
    return (
      i.infId.toLowerCase().includes(filter.toLowerCase()) ||
      i.domain.toLowerCase().includes(filter.toLowerCase())
    );
  });

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">API 목록 (INF)</h2>
          <span className="text-[10px] font-mono text-text-muted">{filtered.length}/{items.length}</span>
        </div>
        <input
          type="text"
          placeholder="API 검색…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
        />
        {domains.length > 0 && (
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
        <div className="w-56 shrink-0 border-r border-border-subtle overflow-y-auto py-1">
          {loading && <div className="px-4 py-3 text-xs text-text-muted">로딩 중…</div>}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-text-muted leading-relaxed">
              {items.length === 0 ? "/sl-recon 실행 후 사용 가능합니다" : "검색 결과 없음"}
            </div>
          )}
          {filtered.map((item) => {
            const ep = endpoints[item.infId];
            const active = selected?.infId === item.infId;
            return (
              <button
                key={item.infId}
                onClick={() => setSelected(item)}
                className={`w-full text-left px-3 py-2.5 border-b border-border-subtle transition-colors ${
                  active ? "bg-accent/8 border-l-2 border-l-accent" : "hover:bg-elevated"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {ep && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${METHOD_CLS[ep.method] ?? "bg-elevated text-text-muted border-border-subtle"}`}>
                      {ep.method}
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-accent font-semibold">{item.infId}</span>
                </div>
                <div className="text-[10px] text-text-muted truncate">{item.domain}</div>
                {ep && (
                  <div className="text-[10px] font-mono text-text-muted/50 truncate">{ep.path}</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border-subtle flex-wrap">
                <span className="text-sm font-mono text-accent font-semibold">{selected.infId}</span>
                <span className="text-xs text-text-muted">—</span>
                <span className="text-xs text-text-secondary">{selected.domain}</span>
                {endpoints[selected.infId] && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ml-auto ${METHOD_CLS[endpoints[selected.infId]!.method] ?? ""}`}>
                    {endpoints[selected.infId]!.method} {endpoints[selected.infId]!.path}
                  </span>
                )}
              </div>
              <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
                {content || "로딩 중…"}
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-muted">
              좌측에서 API를 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
