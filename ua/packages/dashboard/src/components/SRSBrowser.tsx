import { useEffect, useState } from "react";
import { useDashboardStore } from "../store";
import SpecMarkdown from "./SpecMarkdown";

interface SRSItem {
  srsId: string;
  domain: string;
  path: string;
  title?: string;
}

export default function SRSBrowser() {
  const srsList = useDashboardStore((s) => s.srsList);
  const [selected, setSelected] = useState<SRSItem | null>(null);
  const [content, setContent] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) { setContent(""); return; }
    setLoading(true);
    fetch(`/spec-file?path=${encodeURIComponent(selected.path)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then((text) => { setContent(text); setLoading(false); })
      .catch(() => { setContent("로드 실패"); setLoading(false); });
  }, [selected]);

  const domains = Array.from(new Set(srsList.map((i) => i.domain)));

  const filtered = srsList.filter((i) => {
    if (domainFilter && i.domain !== domainFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      i.srsId.toLowerCase().includes(q) ||
      i.domain.toLowerCase().includes(q) ||
      (i.title?.toLowerCase().includes(q) ?? false)
    );
  });

  // domain → items 그룹핑 (도메인 필터 없을 때만)
  const grouped = domainFilter
    ? null
    : domains.reduce<Record<string, SRSItem[]>>((acc, d) => {
        acc[d] = filtered.filter((i) => i.domain === d);
        return acc;
      }, {});

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">
            기능 명세서 (SRS)
          </h2>
          <span className="text-[10px] font-mono text-text-muted">{filtered.length}/{srsList.length}</span>
        </div>
        <input
          type="text"
          placeholder="SRS 검색…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
        />
        {domains.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setDomainFilter(null)}
              className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                !domainFilter
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border-subtle text-text-muted hover:text-text-secondary"
              }`}
            >
              전체
            </button>
            {domains.map((d) => (
              <button
                key={d}
                onClick={() => setDomainFilter(d === domainFilter ? null : d)}
                className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                  domainFilter === d
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border-subtle text-text-muted hover:text-text-secondary"
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
          {srsList.length === 0 && (
            <div className="px-4 py-4 text-xs text-text-muted leading-relaxed">
              <p className="mb-1">SRS 파일 없음</p>
              <p className="text-text-muted/60">
                docs/03_기능명세서/ 에 SRS_v1.0.md 또는 SRS_&#123;domain&#125;.md 파일을 생성하세요
              </p>
            </div>
          )}
          {srsList.length > 0 && filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-text-muted">검색 결과 없음</div>
          )}

          {grouped
            ? Object.entries(grouped).map(([domain, items]) =>
                items.length === 0 ? null : (
                  <div key={domain}>
                    <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-muted/60 bg-elevated/40 border-b border-border-subtle">
                      {domain}
                    </div>
                    {items.map((item) => (
                      <SRSListItem
                        key={item.srsId}
                        item={item}
                        active={selected?.srsId === item.srsId}
                        onClick={() => setSelected(item)}
                      />
                    ))}
                  </div>
                )
              )
            : filtered.map((item) => (
                <SRSListItem
                  key={item.srsId}
                  item={item}
                  active={selected?.srsId === item.srsId}
                  onClick={() => setSelected(item)}
                />
              ))}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {selected ? (
            <>
              <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 flex items-center gap-3">
                <span
                  className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                  style={{
                    background: "rgba(147,197,253,0.12)",
                    color: "var(--color-spec-srs)",
                  }}
                >
                  {selected.srsId}
                </span>
                <span className="text-xs text-text-muted">—</span>
                <span className="text-xs text-text-secondary">
                  {selected.title ?? selected.domain}
                </span>
                <span className="text-[10px] font-mono text-text-muted/50 ml-auto truncate max-w-xs">
                  {selected.path}
                </span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {loading ? (
                  <span className="text-xs text-text-muted">로딩 중…</span>
                ) : content ? (
                  <SpecMarkdown content={content} />
                ) : (
                  <span className="text-xs text-text-muted">내용 없음</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-muted">
              좌측에서 SRS 문서를 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SRSListItem({
  item,
  active,
  onClick,
}: {
  item: SRSItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-border-subtle transition-colors ${
        active ? "bg-accent/8 border-l-2 border-l-accent" : "hover:bg-elevated"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="text-[10px] font-mono font-semibold"
          style={{ color: "var(--color-spec-srs)" }}
        >
          {item.srsId}
        </span>
      </div>
      {item.title ? (
        <div className="text-[10px] text-text-secondary truncate">{item.title}</div>
      ) : (
        <div className="text-[10px] text-text-muted truncate">{item.domain}</div>
      )}
    </button>
  );
}
