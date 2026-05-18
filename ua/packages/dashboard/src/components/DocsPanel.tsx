import { useEffect, useRef, useState, useCallback } from "react";
import { useDashboardStore } from "../store";

// ── Types ──────────────────────────────────────────────────────────────────────

interface FileNode { type: "file"; name: string; path: string }
interface DirNode  { type: "dir"; name: string; label?: string; icon?: string; children: TreeNode[] }
type TreeNode = FileNode | DirNode;

// ── Phase definitions ─────────────────────────────────────────────────────────

interface Phase {
  key: string;
  label: string;
  desc: string;
  color: string;      // accent color (used for borders / text)
  dirPatterns: string[];
}

const PHASES: Phase[] = [
  { key: "rd",  label: "RD",  desc: "요구사항 정의서", color: "#a78bfa", dirPatterns: ["01_요구사항정의서", "01_RD"] },
  { key: "srs", label: "SRS", desc: "기능 명세서",     color: "#60a5fa", dirPatterns: ["03_기능명세서", "03_SRS"] },
  { key: "sad", label: "SAD", desc: "아키텍처 설계서", color: "#94a3b8", dirPatterns: ["04_아키텍처설계서", "04_SAD"] },
  { key: "ddd", label: "DDD", desc: "상세 설계",       color: "#34d399", dirPatterns: ["05_설계서", "05_DDD"] },
  { key: "rtm", label: "RTM", desc: "추적 매트릭스",   color: "#818cf8", dirPatterns: ["02_추적표", "02_RTM"] },
  { key: "tc",  label: "TC",  desc: "테스트케이스",    color: "#fbbf24", dirPatterns: ["07_테스트케이스", "07_TC"] },
  { key: "tr",  label: "TR",  desc: "테스트 결과",     color: "#4ade80", dirPatterns: ["08_테스트결과보고서", "08_TR"] },
];

// RTM flow edges (phase key → phase key)
const FLOW_EDGES = [
  { s: "rd",  t: "srs" },
  { s: "srs", t: "sad" },
  { s: "srs", t: "ddd" },
  { s: "ddd", t: "tc"  },
  { s: "tc",  t: "tr"  },
  { s: "rd",  t: "rtm" },
  { s: "ddd", t: "rtm" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileIcon(name: string): string {
  if (/^RD_|^REQ-/.test(name))  return "📋";
  if (/^SRS_|^SRS-/.test(name)) return "📝";
  if (/^RTM_/.test(name))       return "🔗";
  if (/^SAD_/.test(name))       return "🏗";
  if (/^TC_|^TC-/.test(name))   return "🧪";
  if (/^TR_/.test(name))        return "📊";
  if (/^API_|^INF/.test(name))  return "🔌";
  if (/^DB_|^SCH/.test(name))   return "🗄";
  if (/^UIS-|^UI_/.test(name))  return "🖼";
  return "📄";
}

function collectFiles(nodes: TreeNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    if (n.type === "file") out.push(n);
    else out.push(...collectFiles(n.children));
  }
  return out;
}

function matchPhase(node: DirNode): Phase | undefined {
  return PHASES.find(p => p.dirPatterns.some(pat => node.name === pat || node.label === pat));
}

const REQ_ID_RE = /\b(REQ-[A-Z]+-\d+|SRS-F-\d+|TC-[A-Z]+-\d+|UIS-F-\d+|INF-\d+|SCH-\d+)\b/g;

// ── TreeItem ──────────────────────────────────────────────────────────────────

function TreeItem({
  node, depth, activePath, onSelect,
}: {
  node: TreeNode; depth: number; activePath: string | null; onSelect: (p: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = depth * 14;

  if (node.type === "file") {
    const active = activePath === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${indent + 8}px` }}
        className={`w-full text-left py-1.5 pr-3 text-[11px] flex items-center gap-1.5 truncate rounded-md transition-colors ${
          active
            ? "bg-accent/15 text-accent font-medium"
            : "text-text-secondary hover:bg-elevated hover:text-text-primary"
        }`}
      >
        <span className="shrink-0 text-[10px]">{fileIcon(node.name)}</span>
        <span className="truncate">{node.name.replace(/\.md$/, "")}</span>
      </button>
    );
  }

  const phase = matchPhase(node);
  const label = node.label ?? node.name;
  const icon  = node.icon ?? "📁";

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ paddingLeft: `${indent}px` }}
        className="w-full text-left py-1.5 px-2 text-[11px] flex items-center gap-1.5 text-text-secondary hover:bg-elevated rounded-md transition-colors"
      >
        <span className="text-text-muted w-3 shrink-0 text-[9px]">{open ? "▾" : "▸"}</span>
        <span className="shrink-0">{icon}</span>
        <span
          className="truncate font-medium"
          style={phase ? { color: phase.color } : undefined}
        >
          {label}
        </span>
        <span className="ml-auto text-[10px] text-text-muted shrink-0">
          {collectFiles(node.children).length}
        </span>
      </button>
      {open && (
        <div>
          {node.children.map((child, i) => (
            <TreeItem key={i} node={child} depth={depth + 1} activePath={activePath} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── PhaseNode (map view card) ─────────────────────────────────────────────────

interface PhaseNodeProps {
  phase: Phase;
  fileCount: number;
  active: boolean;
  onClick: () => void;
  x: number;
  y: number;
  w: number;
  h: number;
}

function PhaseNode({ phase, fileCount, active, onClick, x, y, w, h }: PhaseNodeProps) {
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }}>
      <rect
        x={x} y={y} width={w} height={h} rx={8}
        fill={active ? `${phase.color}22` : "var(--color-elevated)"}
        stroke={active ? phase.color : "var(--color-border-subtle)"}
        strokeWidth={active ? 1.5 : 1}
        className="transition-all"
      />
      <text x={x + w / 2} y={y + h * 0.38} textAnchor="middle" fill={phase.color} fontSize={13} fontWeight={700} fontFamily="monospace">
        {phase.label}
      </text>
      <text x={x + w / 2} y={y + h * 0.62} textAnchor="middle" fill="var(--color-text-muted)" fontSize={9}>
        {phase.desc}
      </text>
      {fileCount > 0 && (
        <>
          <rect x={x + w - 22} y={y - 8} width={22} height={16} rx={8} fill={phase.color} />
          <text x={x + w - 11} y={y + 4} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={700}>
            {fileCount}
          </text>
        </>
      )}
    </g>
  );
}

// ── DocMap ────────────────────────────────────────────────────────────────────

function DocMap({
  tree, activePhase, onSelectPhase,
}: {
  tree: TreeNode[];
  activePhase: string | null;
  onSelectPhase: (key: string) => void;
}) {
  // Gather file counts per phase from tree
  const phaseCounts: Record<string, number> = {};
  for (const n of tree) {
    if (n.type !== "dir") continue;
    const phase = matchPhase(n);
    if (phase) phaseCounts[phase.key] = collectFiles(n.children).length;
  }

  // Layout: 2 rows
  // Row 0 (top): RD  SRS  DDD  TC  TR
  // Row 1 (bot): (gap) SAD (gap) RTM (gap)
  const W = 86; const H = 52; const GX = 22; const GY = 20;
  const ROW_Y = [20, 100];
  const COL_X = [10, 10 + W + GX, 10 + 2*(W+GX), 10 + 3*(W+GX), 10 + 4*(W+GX)];

  interface PosMap { [key: string]: { x: number; y: number } }
  const POS: PosMap = {
    rd:  { x: COL_X[0], y: ROW_Y[0] },
    srs: { x: COL_X[1], y: ROW_Y[0] },
    ddd: { x: COL_X[2], y: ROW_Y[0] },
    tc:  { x: COL_X[3], y: ROW_Y[0] },
    tr:  { x: COL_X[4], y: ROW_Y[0] },
    sad: { x: COL_X[1], y: ROW_Y[1] },
    rtm: { x: COL_X[2], y: ROW_Y[1] },
  };

  const svgW = COL_X[4] + W + 10;
  const svgH = ROW_Y[1] + H + 16;

  const cx = (key: string) => POS[key].x + W / 2;
  const cy = (key: string) => POS[key].y + H / 2;
  const cy_top = (key: string) => POS[key].y;
  const cy_bot = (key: string) => POS[key].y + H;
  const cx_right = (key: string) => POS[key].x + W;
  const cx_left = (key: string) => POS[key].x;

  const arrowPath = (s: string, t: string) => {
    const sx = cx(s), sy = cy(s), tx = cx(t), ty = cy(t);
    if (Math.abs(sy - ty) < 5) {
      // horizontal
      const x1 = POS[s].x + W, x2 = POS[t].x;
      return `M${x1},${sy} L${x2},${ty}`;
    }
    // vertical (downward)
    return `M${sx},${cy_bot(s)} L${tx},${cy_top(t)}`;
  };

  return (
    <div className="flex-1 overflow-auto flex items-start justify-center p-4">
      <svg width={svgW} height={svgH} className="overflow-visible">
        {/* Flow edges */}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-border-medium)" />
          </marker>
        </defs>
        {FLOW_EDGES.map(({ s, t }, i) => (
          <path
            key={i}
            d={arrowPath(s, t)}
            stroke="var(--color-border-medium)"
            strokeWidth={1.5}
            fill="none"
            markerEnd="url(#arrow)"
            strokeDasharray={s === "rd" && t === "rtm" ? "4,3" : undefined}
          />
        ))}
        {/* Phase nodes */}
        {PHASES.map(phase => (
          <PhaseNode
            key={phase.key}
            phase={phase}
            fileCount={phaseCounts[phase.key] ?? 0}
            active={activePhase === phase.key}
            onClick={() => onSelectPhase(phase.key)}
            x={POS[phase.key].x}
            y={POS[phase.key].y}
            w={W}
            h={H}
          />
        ))}
      </svg>
    </div>
  );
}

// ── Content renderer ──────────────────────────────────────────────────────────

function DocContent({
  content, activePath, loading, onReqIdClick, selectedReqId,
}: {
  content: string; activePath: string | null; loading: boolean;
  onReqIdClick: (id: string) => void; selectedReqId: string | null;
}) {
  const renderWithHighlights = (text: string) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const re = new RegExp(REQ_ID_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
      }
      const id = match[0];
      parts.push(
        <span
          key={`r${match.index}`}
          onClick={() => onReqIdClick(id)}
          className={`cursor-pointer font-mono px-1 py-0.5 rounded text-[11px] transition-colors ${
            id === selectedReqId
              ? "bg-accent text-white"
              : "bg-accent/10 text-accent hover:bg-accent/20"
          }`}
        >
          {id}
        </span>
      );
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }
    return parts;
  };

  return (
    <div className="flex-1 min-w-0 overflow-auto p-4">
      {activePath && (
        <div className="text-[10px] font-mono text-text-muted mb-3 truncate border-b border-border-subtle pb-2">
          {activePath}
        </div>
      )}
      {loading ? (
        <div className="text-text-muted text-sm">로딩 중…</div>
      ) : content ? (
        <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-text-secondary">
          {renderWithHighlights(content)}
        </pre>
      ) : (
        <div className="flex items-center justify-center h-32 text-text-muted text-sm">
          {activePath ? "파일을 찾을 수 없습니다" : "파일을 선택하세요"}
        </div>
      )}
    </div>
  );
}

// ── Main DocsPanel ────────────────────────────────────────────────────────────

export default function DocsPanel() {
  const { setSelectedReqId, selectedReqId } = useDashboardStore();
  const [mode, setMode] = useState<"tree" | "map">("tree");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [phaseFiles, setPhaseFiles] = useState<FileNode[]>([]);

  // Tree load
  useEffect(() => {
    fetch("/api/docs-tree")
      .then(r => r.ok ? r.json() : [])
      .then((data: TreeNode[]) => {
        setTree(data);
        // auto-select first file
        const first = collectFiles(data)[0];
        if (first) setActivePath(first.path);
        setTreeLoading(false);
      })
      .catch(() => setTreeLoading(false));
  }, []);

  // Content load
  useEffect(() => {
    if (!activePath) { setContent(""); return; }
    setLoading(true);
    fetch(`/spec-file?path=${encodeURIComponent(activePath)}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => { setContent(text); setLoading(false); })
      .catch(() => { setContent("파일을 찾을 수 없습니다."); setLoading(false); });
  }, [activePath]);

  // Phase → files mapping (for map view)
  const handleSelectPhase = useCallback((key: string) => {
    setActivePhase(prev => prev === key ? null : key);
    const phase = PHASES.find(p => p.key === key);
    if (!phase) return;
    const dir = tree.find(n => n.type === "dir" && phase.dirPatterns.some(pat => n.name === pat || (n as DirNode).label === pat)) as DirNode | undefined;
    setPhaseFiles(dir ? collectFiles(dir.children) : []);
  }, [tree]);

  // SSE refresh
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string };
        if (msg.type === "file-changed") {
          fetch("/api/docs-tree")
            .then(r => r.ok ? r.json() : [])
            .then((data: TreeNode[]) => setTree(data))
            .catch(() => {});
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle shrink-0 bg-surface">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">산출물 문서</h2>
        <div className="flex items-center bg-elevated rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMode("tree")}
            className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
              mode === "tree" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            계층
          </button>
          <button
            type="button"
            onClick={() => setMode("map")}
            className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
              mode === "map" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            맵
          </button>
        </div>
      </div>

      {treeLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-text-muted text-sm">로딩 중…</span>
        </div>
      ) : tree.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
          <span className="text-text-muted text-sm">산출물 문서가 없습니다</span>
          <span className="text-[11px] text-text-muted/60">/sl-spec 또는 /sl-recon 실행 후 사용 가능</span>
        </div>
      ) : mode === "tree" ? (
        /* Tree layout */
        <div className="flex flex-1 min-h-0">
          {/* Left: file tree */}
          <div className="w-56 shrink-0 border-r border-border-subtle overflow-y-auto py-2 px-1">
            {tree.map((node, i) => (
              <TreeItem key={i} node={node} depth={0} activePath={activePath} onSelect={setActivePath} />
            ))}
          </div>
          {/* Right: content */}
          <DocContent
            content={content}
            activePath={activePath}
            loading={loading}
            onReqIdClick={(id) => setSelectedReqId(id === selectedReqId ? null : id)}
            selectedReqId={selectedReqId}
          />
        </div>
      ) : (
        /* Map layout */
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Phase diagram */}
          <div className="shrink-0 border-b border-border-subtle">
            <DocMap tree={tree} activePhase={activePhase} onSelectPhase={handleSelectPhase} />
          </div>
          {/* Phase file list + content */}
          <div className="flex flex-1 min-h-0">
            {/* File list for selected phase */}
            {activePhase && phaseFiles.length > 0 && (
              <div className="w-52 shrink-0 border-r border-border-subtle overflow-y-auto py-2 px-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                  {PHASES.find(p => p.key === activePhase)?.desc}
                </div>
                {phaseFiles.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePath(f.path)}
                    className={`w-full text-left py-1.5 px-3 text-[11px] flex items-center gap-1.5 truncate rounded-md transition-colors ${
                      activePath === f.path
                        ? "bg-accent/15 text-accent font-medium"
                        : "text-text-secondary hover:bg-elevated hover:text-text-primary"
                    }`}
                  >
                    <span className="shrink-0 text-[10px]">{fileIcon(f.name)}</span>
                    <span className="truncate">{f.name.replace(/\.md$/, "")}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Content */}
            <DocContent
              content={content}
              activePath={activePath}
              loading={loading}
              onReqIdClick={(id) => setSelectedReqId(id === selectedReqId ? null : id)}
              selectedReqId={selectedReqId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
