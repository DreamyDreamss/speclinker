import { useState, useEffect } from "react";
import { useDashboardStore } from "../store";
import SpecMarkdown from "./SpecMarkdown";

// ─── Tree types ──────────────────────────────────────────────────────────────

interface FileNode {
  type: "file";
  name: string;
  path: string;
}

interface DirNode {
  type: "dir";
  name: string;
  label?: string;
  icon?: string;
  children: TreeNode[];
}

type TreeNode = FileNode | DirNode;

// ─── Layer metadata ──────────────────────────────────────────────────────────

const DIR_META: Record<string, { label: string; icon: string }> = {
  "01_RD":   { label: "요구사항 정의서 (RD)",  icon: "📋" },
  "02_RTM":  { label: "추적 매트릭스 (RTM)",   icon: "🔗" },
  "03_SRS":  { label: "기능 명세서 (SRS)",     icon: "📝" },
  "04_SAD":  { label: "아키텍처 설계서 (SAD)", icon: "🏗️" },
  "05_DDD":  { label: "상세 설계 (DDD)",       icon: "📐" },
  "07_TC":   { label: "테스트케이스 (TC)",     icon: "🧪" },
  "08_TR":   { label: "테스트 결과 (TR)",      icon: "📊" },
  "domains": { label: "도메인별",              icon: "🗂️" },
  "api":     { label: "API 상세",              icon: "🔌" },
  "schema":  { label: "DB 스키마 상세",        icon: "🗄️" },
  "screens": { label: "화면 설계 상세",        icon: "🖼️" },
  "req":     { label: "요구사항 상세",         icon: "📄" },
  "srs":     { label: "명세 상세",             icon: "📄" },
};

// REQ_ID_RE kept for potential future inline highlighting

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(name: string): string {
  if (/^RD_|^REQ-/.test(name))    return "📋";
  if (/^SRS_|^SRS-/.test(name))   return "📝";
  if (/^RTM_/.test(name))         return "🔗";
  if (/^SAD_/.test(name))         return "🏗️";
  if (/^TC_|^TC-/.test(name))     return "🧪";
  if (/^TR_/.test(name))          return "📊";
  if (/^API_|^INF/.test(name))    return "🔌";
  if (/^DB_|^SCH/.test(name))     return "🗄️";
  if (/^UIS-|^UI_/.test(name))    return "🖼️";
  return "📄";
}

function findFirstFile(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.type === "dir") {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

// ─── TreeItem ────────────────────────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (p: string) => void;
}) {
  // 최상위 레이어(depth=0 dir)는 기본 열림
  const [open, setOpen] = useState(depth < 1);
  const pl = depth * 12;

  if (node.type === "file") {
    const active = activePath === node.path;
    return (
      <button
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${pl + 8}px` }}
        className={`w-full text-left py-1 pr-2 text-xs flex items-center gap-1.5 truncate rounded transition-colors ${
          active
            ? "bg-purple-700 text-white"
            : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        }`}
      >
        <span className="shrink-0">{fileIcon(node.name)}</span>
        <span className="truncate">{node.name.replace(/\.md$/, "")}</span>
      </button>
    );
  }

  const meta = DIR_META[node.name];
  const label = node.label ?? meta?.label ?? node.name;
  const icon  = node.icon  ?? meta?.icon  ?? "📁";

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ paddingLeft: `${pl}px` }}
        className="w-full text-left py-1 px-2 text-xs flex items-center gap-1.5 text-gray-300 hover:bg-gray-700 rounded transition-colors"
      >
        <span className="text-gray-500 w-3 shrink-0">{open ? "▾" : "▸"}</span>
        <span className="shrink-0">{icon}</span>
        <span className="truncate font-medium">{label}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child, i) => (
            <TreeItem
              key={i}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SpecPanel ────────────────────────────────────────────────────────────────

export default function SpecPanel() {
  const { setSelectedReqId } = useDashboardStore();
  void setSelectedReqId; // kept for future REQ-ID click linking
  const [tree, setTree]             = useState<TreeNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent]       = useState<string>("");
  const [loading, setLoading]       = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);

  // 트리 초기 로드
  useEffect(() => {
    fetch("/api/docs-tree")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: TreeNode[]) => {
        setTree(data);
        const first = findFirstFile(data);
        if (first) setActivePath(first);
        setTreeLoading(false);
      })
      .catch(() => setTreeLoading(false));
  }, []);

  // 파일 내용 로드
  useEffect(() => {
    if (!activePath) return;
    setLoading(true);
    setContent("");
    fetch(`/spec-file?path=${encodeURIComponent(activePath)}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => { setContent(text); setLoading(false); })
      .catch(() => { setContent("파일을 찾을 수 없습니다."); setLoading(false); });
  }, [activePath]);

  return (
    <div className="flex h-full bg-surface text-text-primary overflow-hidden">
      {/* 파일 트리 사이드바 */}
      <div className="w-48 min-w-[12rem] border-r border-gray-700 overflow-y-auto py-1 shrink-0">
        {treeLoading ? (
          <div className="text-gray-500 text-xs p-2">로딩 중…</div>
        ) : tree.length === 0 ? (
          <div className="text-gray-500 text-xs p-2 leading-relaxed">
            docs/ 없음
            <br />
            <span className="text-gray-600">/sl-spec 실행 후 새로고침</span>
          </div>
        ) : (
          tree.map((node, i) => (
            <TreeItem
              key={i}
              node={node}
              depth={0}
              activePath={activePath}
              onSelect={setActivePath}
            />
          ))
        )}
      </div>

      {/* 파일 내용 */}
      <div className="flex-1 overflow-auto min-w-0 flex flex-col">
        {activePath && (
          <div className="text-text-muted/50 text-[10px] px-3 pt-2 pb-1 font-mono truncate border-b border-border-subtle shrink-0">
            {activePath}
          </div>
        )}
        {loading ? (
          <div className="text-text-muted text-xs p-3">로딩 중…</div>
        ) : content ? (
          <div className="flex-1 overflow-auto">
            <SpecMarkdown content={content} className="p-3" />
          </div>
        ) : (
          <div className="text-text-muted text-xs p-3">내용 없음</div>
        )}
      </div>
    </div>
  );
}
