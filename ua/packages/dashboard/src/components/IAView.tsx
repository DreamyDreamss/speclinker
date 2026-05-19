import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import SpecMarkdown from "./SpecMarkdown";

// ─── Data Types ────────────────────────────────────────────────────────────────

interface IAScreen {
  uisId: string;
  title: string;
  route: string;
  specPath: string;
  entryFile: string;
  infList: string[];
  hasSpec: boolean;
  source: string;
}

interface MenuNode {
  label: string;
  screens: IAScreen[];
  children?: Record<string, MenuNode>;
}

interface IADomain {
  name: string;
  screenCount: number;
  infCount: number;
  menuTree: Record<string, MenuNode>;
}

interface IAMap {
  project: string;
  generated: string;
  totalScreens: number;
  totalApis: number;
  domains: IADomain[];
  matrix: {
    screens: string[];
    apis: string[];
    links: Array<{ uisId: string; infId: string }>;
  };
  infMeta?: Record<string, { domain: string; path: string }>;
}

// ─── View Modes ────────────────────────────────────────────────────────────────

type ViewMode = "tree" | "matrix";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all IAScreen objects from a MenuNode tree, depth-first. */
function collectScreens(node: MenuNode): IAScreen[] {
  const result: IAScreen[] = [...node.screens];
  if (node.children) {
    for (const child of Object.values(node.children)) {
      result.push(...collectScreens(child));
    }
  }
  return result;
}

/** Derive domain name from specPath or infId. */
function inferDomain(path: string): string {
  // e.g. "docs/05_설계서/order/INF/INF-001.md" → "order"
  const m = path.match(/05_설계서\/([^/]+)\//);
  return m ? m[1] : "";
}

/** Build INF spec path from domain + infId. */
function infSpecPath(domain: string, infId: string): string {
  return `docs/05_설계서/${domain}/INF/${infId}.md`;
}

// ─── INF Badge ────────────────────────────────────────────────────────────────

function InfBadge({
  infId,
  onClick,
  active,
}: {
  infId: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
        active
          ? "bg-accent/20 border-accent text-accent"
          : "bg-accent/8 border-accent/40 text-accent hover:bg-accent/15 hover:border-accent/70"
      }`}
    >
      {infId}
    </button>
  );
}

// ─── Tree Panel ───────────────────────────────────────────────────────────────

function ScreenItem({
  screen,
  selected,
  highlight,
  onSelect,
}: {
  screen: IAScreen;
  selected: boolean;
  highlight: boolean;
  onSelect: (s: IAScreen) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(screen)}
      title={screen.route}
      className={`w-full text-left pl-8 pr-2 py-1.5 flex flex-col gap-0.5 transition-colors rounded-sm ${
        selected
          ? "bg-accent/10 border-l-2 border-accent"
          : highlight
          ? "bg-accent/5"
          : "hover:bg-elevated"
      } ${!screen.hasSpec ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            screen.hasSpec ? "bg-accent" : "bg-border-subtle"
          }`}
        />
        <span
          className={`text-[10px] font-mono font-semibold shrink-0 ${
            selected ? "text-accent" : "text-accent/80"
          }`}
        >
          {screen.uisId}
        </span>
        {screen.title && (
          <span className="text-[10px] text-text-secondary truncate">{screen.title}</span>
        )}
      </div>
      {screen.route && (
        <span className="text-[9px] font-mono text-text-muted/50 pl-3 truncate">{screen.route}</span>
      )}
    </button>
  );
}

function MenuNodeRow({
  nodeKey,
  node,
  depth,
  selectedScreen,
  searchQuery,
  onSelectScreen,
}: {
  nodeKey: string;
  node: MenuNode;
  depth: number;
  selectedScreen: IAScreen | null;
  searchQuery: string;
  onSelectScreen: (s: IAScreen) => void;
}) {
  const [open, setOpen] = useState(depth <= 1);

  const allScreens = useMemo(() => collectScreens(node), [node]);
  const hasMatch = useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return allScreens.some(
      (s) =>
        s.uisId.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.route.toLowerCase().includes(q)
    );
  }, [allScreens, searchQuery]);

  useEffect(() => {
    if (searchQuery && hasMatch) setOpen(true);
  }, [searchQuery, hasMatch]);

  if (!hasMatch) return null;

  const childKeys = node.children ? Object.keys(node.children) : [];
  const label = nodeKey === "_root" ? "(메뉴 외)" : (node.label || nodeKey);
  const indentPx = depth * 12 + 8;

  return (
    <div>
      {/* Node header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 py-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors hover:bg-elevated rounded-sm"
        style={{ paddingLeft: indentPx }}
      >
        <span className="text-[8px] shrink-0">{open ? "▼" : "▶"}</span>
        <span className="font-medium">{label}</span>
        <span className="ml-auto text-text-muted/50 pr-2 font-mono">{allScreens.length}</span>
      </button>

      {/* Screens directly under this node */}
      {open &&
        node.screens.map((s) => {
          const q = searchQuery.toLowerCase();
          const highlight =
            !!searchQuery &&
            (s.uisId.toLowerCase().includes(q) ||
              s.title.toLowerCase().includes(q) ||
              s.route.toLowerCase().includes(q));
          return (
            <ScreenItem
              key={s.uisId}
              screen={s}
              selected={selectedScreen?.uisId === s.uisId}
              highlight={highlight}
              onSelect={onSelectScreen}
            />
          );
        })}

      {/* Child menu nodes */}
      {open &&
        childKeys.map((k) => (
          <MenuNodeRow
            key={k}
            nodeKey={k}
            node={node.children![k]}
            depth={depth + 1}
            selectedScreen={selectedScreen}
            searchQuery={searchQuery}
            onSelectScreen={onSelectScreen}
          />
        ))}
    </div>
  );
}

// ─── Spec Content Panel ───────────────────────────────────────────────────────

function SpecContentPanel({
  screen,
  specContent,
  loadingSpec,
  activeInfId,
  onInfClick,
}: {
  screen: IAScreen;
  specContent: string;
  loadingSpec: boolean;
  activeInfId: string | null;
  onInfClick: (infId: string, domain: string) => void;
}) {
  // Derive domain from specPath
  const domain = useMemo(() => inferDomain(screen.specPath), [screen.specPath]);

  if (!screen.hasSpec) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 pt-3 pb-3 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono text-accent font-semibold">{screen.uisId}</span>
            {screen.title && (
              <>
                <span className="text-xs text-text-muted">—</span>
                <span className="text-xs text-text-secondary">{screen.title}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center flex-1 text-xs text-text-muted px-6 text-center leading-relaxed">
          화면 명세가 아직 생성되지 않았습니다.
          <br />
          <span className="text-text-muted/50 font-mono mt-1 block">/sl-dev 또는 /sl-genesis 실행 후 생성됩니다</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Screen header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-subtle shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono text-accent font-semibold">{screen.uisId}</span>
          {screen.title && (
            <>
              <span className="text-xs text-text-muted">—</span>
              <span className="text-xs text-text-secondary">{screen.title}</span>
            </>
          )}
          {screen.route && (
            <span className="text-[10px] font-mono text-text-muted/50 ml-auto">{screen.route}</span>
          )}
        </div>

        {/* Connected APIs */}
        {screen.infList.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-text-muted shrink-0">연결 API:</span>
            {screen.infList.map((infId) => (
              <InfBadge
                key={infId}
                infId={infId}
                active={activeInfId === infId}
                onClick={() => onInfClick(infId, domain)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Spec markdown */}
      <div className="flex-1 overflow-auto p-4">
        {loadingSpec ? (
          <span className="text-xs text-text-muted">로딩 중…</span>
        ) : specContent ? (
          <SpecMarkdown content={specContent} />
        ) : (
          <span className="text-xs text-text-muted">내용 없음</span>
        )}
      </div>
    </div>
  );
}

// ─── Curl Runner ──────────────────────────────────────────────────────────────

interface ParsedRequest {
  method: string;
  path: string;
  body: string | null;
}

/** Parse the first ```http code block from markdown content. */
function parseHttpBlock(content: string): ParsedRequest | null {
  const match = content.match(/```http\r?\n([\s\S]*?)```/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  if (lines.length === 0) return null;

  // First line: "METHOD /path"
  const firstLine = lines[0].trim();
  const methodMatch = firstLine.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)/i);
  if (!methodMatch) return null;
  const method = methodMatch[1].toUpperCase();
  const path = methodMatch[2];

  // Collect body: lines after the blank line that separates headers from body
  let bodyStart = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      bodyStart = i + 1;
      break;
    }
  }
  const bodyLines = bodyStart >= 0 ? lines.slice(bodyStart).filter((l) => l.trim() !== "") : [];
  const body = bodyLines.length > 0 ? bodyLines.join("\n") : null;

  return { method, path, body };
}

function CurlRunner({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ status: number; text: string } | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy curl");

  const parsed = useMemo(() => parseHttpBlock(content), [content]);

  if (!parsed) return null;

  async function handleRun() {
    if (!parsed) return;
    setRunning(true);
    setResult(null);
    try {
      const fetchOptions: RequestInit = {
        method: parsed.method,
        headers: { "Content-Type": "application/json" },
      };
      if (parsed.body && parsed.method !== "GET" && parsed.method !== "HEAD") {
        fetchOptions.body = parsed.body;
      }
      const resp = await fetch(parsed.path, fetchOptions);
      const text = await resp.text();
      setResult({ status: resp.status, text });
    } catch (err) {
      setResult({ status: 0, text: String(err) });
    } finally {
      setRunning(false);
    }
  }

  function handleCopyCurl() {
    if (!parsed) return;
    let cmd = `curl -X ${parsed.method} '${window.location.origin}${parsed.path}'`;
    cmd += ` -H 'Content-Type: application/json'`;
    if (parsed.body) {
      const escaped = parsed.body.replace(/'/g, "'\\''");
      cmd += ` -d '${escaped}'`;
    }
    navigator.clipboard.writeText(cmd).then(() => {
      setCopyLabel("복사됨!");
      setTimeout(() => setCopyLabel("Copy curl"), 2000);
    });
  }

  return (
    <div className="border-t border-border-subtle mt-2 pt-2">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] px-2.5 py-1 rounded border border-border-subtle text-text-muted hover:text-text-secondary hover:border-accent/40 transition-colors"
        >
          Try it
        </button>
      ) : (
        <div className="space-y-2">
          {/* Runner header */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-text-muted bg-elevated px-2 py-0.5 rounded border border-border-subtle">
              {parsed.method} {parsed.path}
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={handleCopyCurl}
                className="text-[10px] px-2 py-0.5 rounded border border-border-subtle text-text-muted hover:text-text-secondary hover:border-accent/40 transition-colors"
              >
                {copyLabel}
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="text-[10px] px-2.5 py-0.5 rounded border border-accent/50 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {running ? "실행 중…" : "Run"}
              </button>
              <button
                type="button"
                onClick={() => { setExpanded(false); setResult(null); }}
                className="text-text-muted hover:text-text-primary transition-colors text-xs leading-none"
                title="닫기"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Response */}
          {result && (
            <div className="space-y-1">
              <span
                className={`text-[10px] font-mono font-semibold ${
                  result.status >= 200 && result.status < 300
                    ? "text-green-400"
                    : result.status === 0
                    ? "text-red-400"
                    : "text-yellow-400"
                }`}
              >
                {result.status === 0 ? "네트워크 오류" : `HTTP ${result.status}`}
              </span>
              <pre className="text-[10px] font-mono bg-elevated border border-border-subtle rounded p-2 overflow-auto max-h-48 text-text-secondary whitespace-pre-wrap break-all">
                {result.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── INF Viewer Panel ─────────────────────────────────────────────────────────

function InfViewerPanel({
  infId,
  domain,
  infPath,
  onClose,
}: {
  infId: string;
  domain: string;
  infPath?: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const resolvedPath = infPath || infSpecPath(domain, infId);
    setLoading(true);
    setContent("");
    fetch(`/spec-file?path=${encodeURIComponent(resolvedPath)}`)
      .then((r) => r.ok ? r.text() : `# ${infId}\n\n파일을 찾을 수 없습니다.\n\n경로: \`${resolvedPath}\``)
      .then((text) => { setContent(text); setLoading(false); })
      .catch(() => { setContent("로드 실패"); setLoading(false); });
  }, [infId, domain, infPath]);

  return (
    <div className="flex flex-col h-full border-l border-border-subtle bg-surface">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle shrink-0 flex items-center gap-2">
        <span className="text-xs font-mono text-accent font-semibold flex-1">{infId}</span>
        {domain && (
          <span className="text-[10px] text-text-muted">{domain}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors text-sm leading-none ml-1"
          title="닫기"
        >
          ✕
        </button>
      </div>

      {/* INF content + curl runner */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <span className="text-xs text-text-muted">로딩 중…</span>
        ) : content ? (
          <>
            <SpecMarkdown content={content} />
            <CurlRunner content={content} />
          </>
        ) : (
          <span className="text-xs text-text-muted">내용 없음</span>
        )}
      </div>
    </div>
  );
}

// ─── Matrix View ──────────────────────────────────────────────────────────────

const COL_WIDTH = 72; // px
const ROW_HEIGHT = 28; // px
const OVERSCAN = 10;

function MatrixView({
  iaMap,
  domainFilter,
  onSelectScreen,
  onSelectInf,
}: {
  iaMap: IAMap;
  domainFilter: string | null;
  onSelectScreen: (uisId: string) => void;
  onSelectInf: (infId: string, domain: string) => void;
}) {
  const { matrix, domains } = iaMap;

  // Scroll-container ref and viewport state for column+row windowing
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);

  // Track container dimensions via ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) setContainerWidth(rect.width);
      if (rect?.height) setContainerHeight(rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollLeft(scrollRef.current.scrollLeft);
      setScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  // Filter screens by domain if needed
  const filteredScreens = useMemo(() => {
    if (!domainFilter) return matrix.screens;
    const domain = domains.find((d) => d.name === domainFilter);
    if (!domain) return matrix.screens;
    const domainScreenIds = new Set<string>();
    for (const node of Object.values(domain.menuTree)) {
      collectScreens(node).forEach((s) => domainScreenIds.add(s.uisId));
    }
    return matrix.screens.filter((id) => domainScreenIds.has(id));
  }, [matrix.screens, domains, domainFilter]);

  const linkSet = useMemo(() => {
    const s = new Set<string>();
    for (const lnk of matrix.links) {
      s.add(`${lnk.uisId}::${lnk.infId}`);
    }
    return s;
  }, [matrix.links]);

  // Column windowing calculations
  const totalCols = matrix.apis.length;
  const visibleStart = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - OVERSCAN);
  const visibleEnd = Math.min(
    totalCols,
    Math.floor(scrollLeft / COL_WIDTH) + Math.ceil(containerWidth / COL_WIDTH) + OVERSCAN + 1
  );
  const paddingLeft = visibleStart * COL_WIDTH;
  const paddingRight = (totalCols - visibleEnd) * COL_WIDTH;
  const visibleApis = matrix.apis.slice(visibleStart, visibleEnd);

  // Row windowing calculations
  const totalRows = filteredScreens.length;
  const visibleRowStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRowEnd = Math.min(
    totalRows,
    Math.floor(scrollTop / ROW_HEIGHT) + Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN + 1
  );
  const paddingTop = visibleRowStart * ROW_HEIGHT;
  const paddingBottom = (totalRows - visibleRowEnd) * ROW_HEIGHT;
  const visibleRows = filteredScreens.slice(visibleRowStart, visibleRowEnd);

  if (filteredScreens.length === 0 || matrix.apis.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-text-muted">
        매트릭스 데이터가 없습니다
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-auto h-full p-3"
      onScroll={handleScroll}
    >
      <table className="border-collapse text-[10px]" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface z-10 px-2 py-1.5 text-left text-text-muted font-semibold border-b border-r border-border-subtle whitespace-nowrap min-w-[100px]">
              UIS / INF
            </th>
            {/* Left padding cell */}
            {paddingLeft > 0 && (
              <th style={{ width: paddingLeft, minWidth: paddingLeft, padding: 0, border: "none" }} aria-hidden="true" />
            )}
            {visibleApis.map((infId) => (
              <th
                key={infId}
                style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                className="px-2 py-1.5 border-b border-border-subtle text-accent/70 font-mono font-semibold whitespace-nowrap cursor-pointer hover:text-accent transition-colors overflow-hidden"
                onClick={() => {
                  const link = matrix.links.find((l) => l.infId === infId);
                  if (link) {
                    const domainScreen = findScreenById(domains, link.uisId);
                    const dom = domainScreen ? inferDomain(domainScreen.specPath) : "";
                    onSelectInf(infId, dom);
                  } else {
                    onSelectInf(infId, "");
                  }
                }}
              >
                <span className="block truncate">{infId}</span>
              </th>
            ))}
            {/* Right padding cell */}
            {paddingRight > 0 && (
              <th style={{ width: paddingRight, minWidth: paddingRight, padding: 0, border: "none" }} aria-hidden="true" />
            )}
          </tr>
        </thead>
        <tbody>
          {/* Top padding row */}
          {paddingTop > 0 && (
            <tr aria-hidden="true" style={{ height: paddingTop }}>
              <td style={{ padding: 0, border: "none" }} colSpan={1 + visibleApis.length + (paddingLeft > 0 ? 1 : 0) + (paddingRight > 0 ? 1 : 0)} />
            </tr>
          )}
          {visibleRows.map((uisId) => (
            <tr key={uisId} className="hover:bg-elevated/40 transition-colors" style={{ height: ROW_HEIGHT }}>
              <td
                className="sticky left-0 bg-surface px-2 py-1.5 font-mono text-accent/80 border-b border-r border-border-subtle whitespace-nowrap cursor-pointer hover:text-accent transition-colors"
                onClick={() => onSelectScreen(uisId)}
              >
                {uisId}
              </td>
              {/* Left padding cell */}
              {paddingLeft > 0 && (
                <td style={{ width: paddingLeft, minWidth: paddingLeft, padding: 0, border: "none" }} aria-hidden="true" />
              )}
              {visibleApis.map((infId) => (
                <td
                  key={infId}
                  style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                  className="px-2 py-1.5 border-b border-border-subtle text-center"
                >
                  {linkSet.has(`${uisId}::${infId}`) ? (
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-accent cursor-pointer hover:bg-accent/70 transition-colors"
                      title={`${uisId} — ${infId}`}
                      onClick={() => {
                        const domainScreen = findScreenById(domains, uisId);
                        const dom = domainScreen ? inferDomain(domainScreen.specPath) : "";
                        onSelectInf(infId, dom);
                      }}
                    />
                  ) : null}
                </td>
              ))}
              {/* Right padding cell */}
              {paddingRight > 0 && (
                <td style={{ width: paddingRight, minWidth: paddingRight, padding: 0, border: "none" }} aria-hidden="true" />
              )}
            </tr>
          ))}
          {/* Bottom padding row */}
          {paddingBottom > 0 && (
            <tr aria-hidden="true" style={{ height: paddingBottom }}>
              <td style={{ padding: 0, border: "none" }} colSpan={1 + visibleApis.length + (paddingLeft > 0 ? 1 : 0) + (paddingRight > 0 ? 1 : 0)} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Find a screen object anywhere in the domain tree. */
function findScreenById(domains: IADomain[], uisId: string): IAScreen | null {
  for (const domain of domains) {
    for (const node of Object.values(domain.menuTree)) {
      const screens = collectScreens(node);
      const found = screens.find((s) => s.uisId === uisId);
      if (found) return found;
    }
  }
  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IAView() {
  const [iaMap, setIaMap] = useState<IAMap | null>(null);
  const [loading, setLoading] = useState(true);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("tree");

  // Tree state
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [selectedScreen, setSelectedScreen] = useState<IAScreen | null>(null);
  const [specContent, setSpecContent] = useState<string>("");
  const [loadingSpec, setLoadingSpec] = useState(false);

  // INF viewer
  const [activeInf, setActiveInf] = useState<{ infId: string; domain: string; infPath?: string } | null>(null);

  // Filter / search
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  // ── Load IA map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/ia-map")
      .then((r) => r.ok ? r.json() : null)
      .then((data: IAMap | null) => {
        setIaMap(data);
        if (data?.domains?.length) {
          setOpenDomains(new Set([data.domains[0].name]));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── SSE: reload ia-map when ia-map.json changes ───────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as { type: string; path?: string };
        if (data.type === "file-changed" && data.path?.includes("ia-map.json")) {
          fetch("/api/ia-map")
            .then((r) => r.ok ? r.json() : null)
            .then((fresh: IAMap | null) => { if (fresh) setIaMap(fresh); })
            .catch(() => {});
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  // ── Load screen spec ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedScreen) { setSpecContent(""); return; }
    if (!selectedScreen.hasSpec) { setSpecContent(""); return; }
    setLoadingSpec(true);
    fetch(`/spec-file?path=${encodeURIComponent(selectedScreen.specPath)}`)
      .then((r) => r.ok ? r.text() : "파일을 찾을 수 없습니다.")
      .then((text) => { setSpecContent(text); setLoadingSpec(false); })
      .catch(() => { setSpecContent("로드 실패"); setLoadingSpec(false); });
  }, [selectedScreen]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function toggleDomain(name: string) {
    setOpenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleSelectScreen(screen: IAScreen) {
    setSelectedScreen(screen);
    setActiveInf(null);
  }

  function handleInfClick(infId: string, domain: string) {
    if (activeInf?.infId === infId) {
      setActiveInf(null);
    } else {
      const meta = iaMap?.infMeta?.[infId];
      setActiveInf({
        infId,
        domain: meta?.domain || domain,
        infPath: meta?.path,
      });
    }
  }

  // When matrix view: select screen by id
  function handleMatrixSelectScreen(uisId: string) {
    if (!iaMap) return;
    const screen = findScreenById(iaMap.domains, uisId);
    if (screen) {
      setSelectedScreen(screen);
      setViewMode("tree");
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const filteredDomains = useMemo(() => {
    if (!iaMap) return [];
    if (!domainFilter) return iaMap.domains;
    return iaMap.domains.filter((d) => d.name === domainFilter);
  }, [iaMap, domainFilter]);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface text-xs text-text-muted">
        IA Map 로딩 중…
      </div>
    );
  }

  if (!iaMap) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface gap-2">
        <span className="text-xs text-text-muted">/sl-recon 실행 후 IA Map을 사용할 수 있습니다</span>
        <span className="text-[10px] font-mono text-text-muted/50">/api/ia-map 응답 없음</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-border-subtle shrink-0 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">IA Map</h2>

          {/* View mode toggle */}
          <div className="flex items-center bg-elevated rounded-lg p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                viewMode === "tree"
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Tree 뷰
            </button>
            <button
              type="button"
              onClick={() => setViewMode("matrix")}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                viewMode === "matrix"
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Matrix 뷰
            </button>
          </div>

          {/* Stats badges */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] font-mono px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-muted">
              화면 {iaMap.totalScreens}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-muted">
              API {iaMap.totalApis}
            </span>
          </div>
        </div>

        {/* Search + domain filter */}
        <input
          type="text"
          placeholder="화면명 / route / UIS-ID 검색…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
        />

        {iaMap.domains.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setDomainFilter(null)}
              className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                !domainFilter
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border-subtle text-text-muted hover:text-text-secondary"
              }`}
            >
              전체
            </button>
            {iaMap.domains.map((d) => (
              <button
                key={d.name}
                type="button"
                onClick={() => setDomainFilter(d.name === domainFilter ? null : d.name)}
                className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                  domainFilter === d.name
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border-subtle text-text-muted hover:text-text-secondary"
                }`}
              >
                {d.name}
                <span className="ml-1 opacity-60">{d.screenCount}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {viewMode === "matrix" ? (
        /* Matrix view */
        <MatrixView
          iaMap={iaMap}
          domainFilter={domainFilter}
          onSelectScreen={handleMatrixSelectScreen}
          onSelectInf={(infId, domain) => handleInfClick(infId, domain)}
        />
      ) : (
        /* Tree view — 3 columns */
        <div className="flex flex-1 min-h-0">
          {/* ── Left: Domain Tree (240px) ──────────────────────────────────── */}
          <div className="w-60 shrink-0 border-r border-border-subtle overflow-y-auto py-1">
            {filteredDomains.length === 0 && (
              <div className="px-4 py-3 text-xs text-text-muted">도메인 없음</div>
            )}

            {filteredDomains.map((domain) => {
              const isOpen = openDomains.has(domain.name);
              const menuKeys = Object.keys(domain.menuTree);

              return (
                <div key={domain.name}>
                  {/* Domain header */}
                  <button
                    type="button"
                    onClick={() => toggleDomain(domain.name)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-text-primary hover:bg-elevated transition-colors"
                  >
                    <span className="text-[8px] text-text-muted shrink-0">
                      {isOpen ? "▼" : "▶"}
                    </span>
                    <span className="flex-1 text-left truncate">{domain.name}</span>
                    <span className="text-[10px] font-mono text-text-muted/60 shrink-0">
                      {domain.screenCount}
                    </span>
                  </button>

                  {/* Menu tree */}
                  {isOpen && (
                    <div className="pb-1">
                      {menuKeys.map((k) => (
                        <MenuNodeRow
                          key={k}
                          nodeKey={k}
                          node={domain.menuTree[k]}
                          depth={1}
                          selectedScreen={selectedScreen}
                          searchQuery={searchQuery}
                          onSelectScreen={handleSelectScreen}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Center: Screen Spec Viewer (flex-1) ───────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {selectedScreen ? (
              <SpecContentPanel
                screen={selectedScreen}
                specContent={specContent}
                loadingSpec={loadingSpec}
                activeInfId={activeInf?.infId ?? null}
                onInfClick={handleInfClick}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-text-muted">
                좌측 트리에서 화면을 선택하세요
              </div>
            )}
          </div>

          {/* ── Right: INF Viewer Panel (320px, slide-in) ─────────────────── */}
          {activeInf && (
            <div className="w-80 shrink-0 overflow-hidden flex flex-col">
              <InfViewerPanel
                infId={activeInf.infId}
                domain={activeInf.domain}
                infPath={activeInf.infPath}
                onClose={() => setActiveInf(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
