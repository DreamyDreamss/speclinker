import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import GraphView from "./components/GraphView";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import SearchBar from "./components/SearchBar";
import NodeInfo from "./components/NodeInfo";
import LayerLegend from "./components/LayerLegend";
import DiffToggle from "./components/DiffToggle";
import FilterPanel from "./components/FilterPanel";
import ExportMenu from "./components/ExportMenu";
import ProjectOverview from "./components/ProjectOverview";
import WarningBanner from "./components/WarningBanner";
import TokenGate from "./components/TokenGate";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";
import SpecPanel from "./components/SpecPanel";
import CommandPanel from "./components/CommandPanel";
import RTMPanel from "./components/RTMPanel";
import MCPStatusBadge from "./components/MCPStatusBadge";
import ReconProgress from "./components/ReconProgress";

const APIExplorer = lazy(() => import("./components/APIExplorer"));
const SRSBrowser = lazy(() => import("./components/SRSBrowser"));
const SpecExplorer = lazy(() => import("./components/SpecExplorer"));
const DocsPanel = lazy(() => import("./components/DocsPanel"));
const IAView = lazy(() => import("./components/IAView"));
const SDDPanel = lazy(() => import("./components/SDDPanel"));

// Lazy-load heavy / optional components so they ship in separate chunks.
const CodeViewer = lazy(() => import("./components/CodeViewer"));
const PathFinderModal = lazy(() => import("./components/PathFinderModal"));
const KeyboardShortcutsHelp = lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const SESSION_TOKEN_KEY = "understand-anything-token";

/** Resolve data file URL — in demo mode, use env var URLs; otherwise use local paths with token. */
function dataUrl(fileName: string, token: string | null): string {
  if (DEMO_MODE) {
    const envMap: Record<string, string | undefined> = {
      "knowledge-graph.json": import.meta.env.VITE_GRAPH_URL,
      "domain-graph.json": import.meta.env.VITE_DOMAIN_GRAPH_URL,
      "meta.json": import.meta.env.VITE_META_URL,
      "diff-overlay.json": import.meta.env.VITE_DIFF_OVERLAY_URL,
    };
    const url = envMap[fileName];
    if (url) return url;
  }
  const path = `/${fileName}`;
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

/**
 * Resolve the access token from the URL query string or sessionStorage.
 * If found in the URL, persist to sessionStorage and strip the param from the address bar.
 */
function resolveInitialToken(): string | null {
  if (DEMO_MODE) return "__demo__";
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, urlToken);
    // Clean the URL
    params.delete("token");
    const cleanSearch = params.toString();
    const newUrl =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
    return urlToken;
  }
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function App() {
  const [accessToken, setAccessToken] = useState<string | null>(resolveInitialToken);

  const handleTokenValid = useCallback((token: string) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    setAccessToken(token);
  }, []);

  // In demo mode, skip token gate entirely
  if (DEMO_MODE) {
    return <Dashboard accessToken="__demo__" />;
  }

  // Show the token gate when no token is available
  if (accessToken === null) {
    return <TokenGate onTokenValid={handleTokenValid} />;
  }

  return <Dashboard accessToken={accessToken} />;
}

function Dashboard({ accessToken }: { accessToken: string }) {
  const graph = useDashboardStore((s) => s.graph);
  const setGraph = useDashboardStore((s) => s.setGraph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const closeCodeViewer = useDashboardStore((s) => s.closeCodeViewer);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const togglePathFinder = useDashboardStore((s) => s.togglePathFinder);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const toggleNodeTypeFilter = useDashboardStore((s) => s.toggleNodeTypeFilter);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setSiGraph = useDashboardStore((s) => s.setSiGraph);
  const siViewActive = useDashboardStore((s) => s.siViewActive);
  const setSiViewActive = useDashboardStore((s) => s.setSiViewActive);
  const selectedReqId = useDashboardStore((s) => s.selectedReqId);
  const reactFlowInstance = useDashboardStore((s) => s.reactFlowInstance);

  const sourceLabels = useDashboardStore((s) => s.sourceLabels);
  const setSourceLabels = useDashboardStore((s) => s.setSourceLabels);
  const selectedSourceLabel = useDashboardStore((s) => s.selectedSourceLabel);
  const setSelectedSourceLabel = useDashboardStore((s) => s.setSelectedSourceLabel);
  const setInfList = useDashboardStore((s) => s.setInfList);
  const setUisList = useDashboardStore((s) => s.setUisList);
  const setSrsList = useDashboardStore((s) => s.setSrsList);
  const setParsedRTM = useDashboardStore((s) => s.setParsedRTM);
  const setReqImplMap = useDashboardStore((s) => s.setReqImplMap);
  const setFuncMap = useDashboardStore((s) => s.setFuncMap);
  const setLinkedFuncMap = useDashboardStore((s) => s.setLinkedFuncMap);

  // 추가 뷰 모드
  const [extraPanel, setExtraPanel] = useState<"none" | "apis" | "docs" | "sdd" | "srs" | "specs" | "ia">("none");

  const [sidebarWidth, setSidebarWidth] = useState(360);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(360);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dx = resizeStartXRef.current - e.clientX;
      const newWidth = Math.min(800, Math.max(240, resizeStartWidthRef.current + dx));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => { isResizingRef.current = false; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    fetch(dataUrl("meta.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
  }, []);

  // 소스 라벨 목록 fetch
  useEffect(() => {
    fetch("/api/source-labels")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { labels: string[] } | null) => {
        if (data?.labels?.length) setSourceLabels(data.labels);
      })
      .catch(() => {});
  }, [setSourceLabels]);

  // INF/UIS 목록 + SDD 데이터 fetch
  useEffect(() => {
    fetch("/api/inf-list")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ infId: string; domain: string; path: string }>) => setInfList(data))
      .catch(() => {});
    fetch("/api/uis-list")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ uisId: string; domain: string; path: string; route?: string }>) => setUisList(data))
      .catch(() => {});
    fetch("/api/rtm-parsed")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (Array.isArray(data)) setParsedRTM(data); })
      .catch(() => {});
    fetch("/api/req-impl-map")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && typeof data === "object") setReqImplMap(data); })
      .catch(() => {});
    fetch("/api/func-map")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (Array.isArray(data)) setFuncMap(data); })
      .catch(() => {});
    fetch("/api/linked-func-map")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && typeof data === "object") setLinkedFuncMap(data); })
      .catch(() => {});
    fetch("/api/srs-list")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ srsId: string; domain: string; path: string; title?: string }>) => setSrsList(data))
      .catch(() => {});
  }, [setInfList, setUisList, setSrsList, setParsedRTM, setReqImplMap, setFuncMap, setLinkedFuncMap]);

  // Auto-detect IA Map on load — default to IA tab when screens exist
  useEffect(() => {
    fetch("/api/ia-map")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { domains?: unknown[] } | null) => {
        if (data?.domains && data.domains.length > 0) {
          setExtraPanel("ia");
        }
      })
      .catch(() => {});
  }, []);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: "Show keyboard shortcuts",
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: "Close panels and modals / go back to overview",
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.pathFinderOpen) {
            state.togglePathFinder();
          } else if (state.filterPanelOpen) {
            state.toggleFilterPanel();
          } else if (state.exportMenuOpen) {
            state.toggleExportMenu();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: "Focus search bar",
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[placeholder*="Search"]'
          );
          searchInput?.focus();
        },
        category: "Navigation",
      },
      // View toggles
      {
        key: "d",
        description: "Toggle diff mode",
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleDiffMode();
        },
        category: "View",
      },
      {
        key: "f",
        description: "Toggle filter panel",
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleFilterPanel();
        },
        category: "View",
      },
      {
        key: "e",
        description: "Toggle export menu",
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleExportMenu();
        },
        category: "View",
      },
      {
        key: "p",
        description: "Open path finder",
        action: () => {
          const state = useDashboardStore.getState();
          state.togglePathFinder();
        },
        category: "View",
      },
    ],
    []
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  // 소스 라벨 변경 시 해당 그래프 로드
  useEffect(() => {
    if (!selectedSourceLabel) return; // null이면 기본 knowledge-graph.json은 아래에서 처리
    const graphFile = `knowledge-graph-${selectedSourceLabel}.json`;
    fetch(dataUrl(graphFile, accessToken))
      .then((res) => res.json())
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues([]);
        }
      })
      .catch(() => {});
  }, [selectedSourceLabel, accessToken, setGraph]);

  useEffect(() => {
    fetch(dataUrl("knowledge-graph.json", accessToken))
      .then((res) => res.json())
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues(result.issues);
          // Auto-detect knowledge graph kind
          if ((data as Record<string, unknown>).kind === "knowledge") {
            setViewMode("knowledge");
            useDashboardStore.getState().setIsKnowledgeGraph(true);
          }
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph]);

  useEffect(() => {
    fetch(dataUrl("diff-overlay.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as { changedNodeIds: string[]; affectedNodeIds: string[] };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(d.changedNodeIds, d.affectedNodeIds);
          }
        }
      })
      .catch(() => {
        // Silently ignore - diff overlay is optional
      });
  }, [setDiffOverlay]);

  useEffect(() => {
    fetch(dataUrl("domain-graph.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        } else if (result.fatal) {
          console.warn(`[domain-graph] validation failed: ${result.fatal}`);
        }
      })
      .catch(() => {
        // Silently ignore — domain graph is optional
      });
  }, [setDomainGraph]);

  useEffect(() => {
    const token = resolveInitialToken();
    fetch(dataUrl("si-graph.json", token))
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => { if (data) setSiGraph(data as import("@understand-anything/core/types").KnowledgeGraph); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedReqId || !reactFlowInstance) return;
    const nodeId = `req:${selectedReqId}`;
    const node = reactFlowInstance.getNodes().find(n => n.id === nodeId);
    if (node) {
      reactFlowInstance.setCenter(node.position.x, node.position.y, { zoom: 1.5, duration: 500 });
    }
  }, [selectedReqId, reactFlowInstance]);

  const sidebarContent = (
    <>
      {selectedNodeId && <NodeInfo />}
      {!selectedNodeId && <ProjectOverview />}
    </>
  );

  return (
    <ThemeProvider metaTheme={metaTheme}>
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay">
      {/* Header */}
      <header className="flex items-center px-5 py-3 bg-surface border-b border-border-subtle shrink-0 gap-4">
        {/* Left — fixed */}
        <div className="flex items-center gap-5 shrink-0">
          <h1 className="font-serif text-lg text-text-primary tracking-wide">
            {graph?.project.name ?? "Understand Anything"}
          </h1>
          {/* 소스 셀렉터 — SOURCE_COUNT > 1 일 때만 표시 */}
          {sourceLabels.length > 1 && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedSourceLabel(null)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    selectedSourceLabel === null
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  All
                </button>
                {sourceLabels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSelectedSourceLabel(label)}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                      selectedSourceLabel === label
                        ? "bg-accent/20 text-accent"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {graph && !isKnowledgeGraph && domainGraph && (
            <>
              <div className="w-px h-5 bg-border-subtle" />
              <div className="flex items-center bg-elevated rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("domain")}
                  title="Switch to domain view"
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "domain"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Domain
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("structural")}
                  title="Switch to structural view"
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === "structural"
                      ? "bg-accent/20 text-accent"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Structural
                </button>
              </div>
            </>
          )}
        </div>

        {/* Middle — scrollable legends */}
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-4 w-max">
            <DiffToggle />
            <div className="flex items-center gap-1">
              {(isKnowledgeGraph ? [
                { key: "knowledge" as const, label: "All", color: "var(--color-node-article)" },
              ] : [
                { key: "code" as const, label: "Code", color: "var(--color-node-file)" },
                { key: "config" as const, label: "Config", color: "var(--color-node-config)" },
                { key: "docs" as const, label: "Docs", color: "var(--color-node-document)" },
                { key: "infra" as const, label: "Infra", color: "var(--color-node-service)" },
                { key: "data" as const, label: "Data", color: "var(--color-node-table)" },
                { key: "domain" as const, label: "Domain", color: "var(--color-node-concept)" },
                { key: "knowledge" as const, label: "Knowledge", color: "var(--color-node-article)" },
              ]).map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => toggleNodeTypeFilter(cat.key)}
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    nodeTypeFilters[cat.key] !== false
                      ? "border-border-medium bg-elevated text-text-secondary hover:text-text-primary"
                      : "border-transparent bg-transparent text-text-muted/40 line-through hover:text-text-muted"
                  }`}
                  title={`${nodeTypeFilters[cat.key] !== false ? "Hide" : "Show"} ${cat.label} nodes`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: cat.color,
                      opacity: nodeTypeFilters[cat.key] !== false ? 1 : 0.3,
                    }}
                  />
                  {cat.label}
                </button>
              ))}
            </div>
            <LayerLegend />
          </div>
        </div>

        {/* Right — fixed actions */}
        <div className="flex items-center gap-4 shrink-0">
          <MCPStatusBadge />
          <div className="flex items-center bg-elevated rounded-lg p-0.5 gap-0.5">
            {([
              { label: "Graph",   isActive: extraPanel === "none" && !siViewActive, onClick: () => { setExtraPanel("none"); setSiViewActive(false); } },
              { label: "SI",      isActive: siViewActive,                           onClick: () => { setExtraPanel("none"); setSiViewActive(!siViewActive); } },
              { label: "IA",      isActive: extraPanel === "ia",                    onClick: () => { setExtraPanel(extraPanel === "ia" ? "none" : "ia"); setSiViewActive(false); } },
              { label: "APIs",    isActive: extraPanel === "apis",                  onClick: () => { setExtraPanel(extraPanel === "apis" ? "none" : "apis"); setSiViewActive(false); } },
              { label: "Specs",   isActive: extraPanel === "specs",                 onClick: () => { setExtraPanel(extraPanel === "specs" ? "none" : "specs"); setSiViewActive(false); } },
              { label: "SRS",     isActive: extraPanel === "srs",                   onClick: () => { setExtraPanel(extraPanel === "srs" ? "none" : "srs"); setSiViewActive(false); } },
              { label: "SDD",     isActive: extraPanel === "sdd",                   onClick: () => { setExtraPanel(extraPanel === "sdd" ? "none" : "sdd"); setSiViewActive(false); } },
              { label: "Docs",    isActive: extraPanel === "docs",                  onClick: () => { setExtraPanel(extraPanel === "docs" ? "none" : "docs"); setSiViewActive(false); } },
            ] as const).map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={tab.onClick}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  tab.isActive
                    ? "bg-accent/15 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "text-text-muted hover:text-text-secondary hover:bg-surface/60"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <FilterPanel />
          <ExportMenu />
          <button
            onClick={togglePathFinder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title="Find path between nodes (P)"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            Path
          </button>
          <ThemePicker />
          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title="Keyboard shortcuts (Shift + ?)"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <SearchBar />

      {/* Validation warning banner */}
      {graphIssues.length > 0 && !loadError && (
        <WarningBanner issues={graphIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main content: extra panel 뷰 */}
      {extraPanel !== "none" ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Compact recon progress bar — shown for data-heavy panels */}
          {extraPanel !== "sdd" && extraPanel !== "srs" && extraPanel !== "specs" && (
            <ReconProgress compact />
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-text-muted">로딩 중...</div>}>
              {extraPanel === "ia" ? <IAView />
                : extraPanel === "apis" ? <APIExplorer />
                : extraPanel === "srs" ? <SRSBrowser />
                : extraPanel === "specs" ? <SpecExplorer />
                : extraPanel === "sdd" ? <SDDPanel />
                : <DocsPanel />}
            </Suspense>
          </div>
        </div>
      ) : /* Main content: 3-panel SDD view or classic Graph + Sidebar */
      siViewActive ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* 좌측: Spec 패널 */}
            <div className="w-60 flex-shrink-0 border-r border-border-subtle overflow-hidden">
              <SpecPanel />
            </div>

            {/* 중앙: 기존 그래프 영역 */}
            <div className="flex-1 overflow-hidden relative min-w-0 min-h-0">
              {viewMode === "knowledge" ? (
                <KnowledgeGraphView />
              ) : viewMode === "domain" && domainGraph ? (
                <DomainGraphView />
              ) : (
                <GraphView />
              )}
              <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
                Press <kbd className="kbd">?</kbd> for keyboard shortcuts
              </div>

              {/* Code viewer overlay */}
              {codeViewerOpen && (
                <div className="absolute bottom-0 left-0 right-0 h-[25vh] bg-surface border-t border-border-subtle animate-slide-up z-20">
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-end px-3 py-1 shrink-0">
                      <button
                        onClick={closeCodeViewer}
                        className="text-text-muted hover:text-text-primary text-xs transition-colors"
                      >
                        Close
                      </button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <Suspense fallback={null}>
                        <CodeViewer />
                      </Suspense>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 우측: 노드 선택 시 NodeInfo, 아니면 Command 패널 */}
            <div className="w-72 flex-shrink-0 border-l border-border-subtle overflow-auto">
              {selectedNodeId ? <NodeInfo /> : <CommandPanel />}
            </div>
          </div>

          {/* 하단: RTM 패널 */}
          <RTMPanel />
        </div>
      ) : (
        /* 기존 레이아웃 */
        <div className="flex-1 flex min-h-0 relative">
          {/* Graph area */}
          <div className="flex-1 min-w-0 min-h-0 relative">
            {viewMode === "knowledge" ? (
              <KnowledgeGraphView />
            ) : viewMode === "domain" && domainGraph ? (
              <DomainGraphView />
            ) : (
              <GraphView />
            )}
            <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
              Press <kbd className="kbd">?</kbd> for keyboard shortcuts
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="w-1 shrink-0 cursor-col-resize bg-border-subtle hover:bg-accent/50 active:bg-accent transition-colors"
            onMouseDown={handleSidebarResizeStart}
          />

          {/* Right sidebar */}
          <aside
            style={{ width: sidebarWidth }}
            className="shrink-0 bg-surface border-l border-border-subtle overflow-auto"
          >
            {sidebarContent}
          </aside>

          {/* Code viewer overlay */}
          {codeViewerOpen && (
            <div className="absolute bottom-0 left-0 right-0 h-[25vh] bg-surface border-t border-border-subtle animate-slide-up z-20">
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-end px-3 py-1 shrink-0">
                  <button
                    onClick={closeCodeViewer}
                    className="text-text-muted hover:text-text-primary text-xs transition-colors"
                  >
                    Close
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={null}>
                    <CodeViewer />
                  </Suspense>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            shortcuts={shortcuts}
            onClose={() => setShowKeyboardHelp(false)}
          />
        </Suspense>
      )}

      {/* Path Finder Modal — only mounted when open so its chunk is lazy-loaded on demand. */}
      {pathFinderOpen && (
        <Suspense fallback={null}>
          <PathFinderModal isOpen={pathFinderOpen} onClose={togglePathFinder} />
        </Suspense>
      )}
    </div>
    </ThemeProvider>
  );
}

export default App;
