import { create } from "zustand";
import { SearchEngine } from "@understand-anything/core/search";
import type { SearchResult } from "@understand-anything/core/search";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import type { ReactFlowInstance } from "@xyflow/react";

export type NavigationLevel = "overview" | "layer-detail";
export type NodeType = "file" | "function" | "class" | "module" | "concept" | "config" | "document" | "service" | "table" | "endpoint" | "pipeline" | "schema" | "resource" | "domain" | "flow" | "step" | "article" | "entity" | "topic" | "claim" | "source" | "req" | "srs" | "tc" | "uis" | "inf" | "sch";
export type Complexity = "simple" | "moderate" | "complex";
export type EdgeCategory = "structural" | "behavioral" | "data-flow" | "dependencies" | "semantic" | "infrastructure" | "domain" | "knowledge" | "si-tracing";
export type ViewMode = "structural" | "domain" | "knowledge" | "si-tracing";

export interface FilterState {
  nodeTypes: Set<NodeType>;
  complexities: Set<Complexity>;
  layerIds: Set<string>;
  edgeCategories: Set<EdgeCategory>;
}

export const ALL_NODE_TYPES: NodeType[] = ["file", "function", "class", "module", "concept", "config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource", "domain", "flow", "step", "article", "entity", "topic", "claim", "source", "req", "srs", "tc", "uis", "inf", "sch"];
export const ALL_COMPLEXITIES: Complexity[] = ["simple", "moderate", "complex"];
export const ALL_EDGE_CATEGORIES: EdgeCategory[] = ["structural", "behavioral", "data-flow", "dependencies", "semantic", "infrastructure", "domain", "knowledge", "si-tracing"];

export const EDGE_CATEGORY_MAP: Record<EdgeCategory, string[]> = {
  structural: ["imports", "exports", "contains", "inherits", "implements"],
  behavioral: ["calls", "subscribes", "publishes", "middleware"],
  "data-flow": ["reads_from", "writes_to", "transforms", "validates"],
  dependencies: ["depends_on", "tested_by", "configures"],
  semantic: ["related", "similar_to"],
  infrastructure: ["deploys", "serves", "provisions", "triggers", "migrates", "documents", "routes", "defines_schema"],
  domain: ["contains_flow", "flow_step", "cross_domain"],
  knowledge: ["cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by"],
  "si-tracing": ["satisfies", "traces_to"],
};

export const DOMAIN_EDGE_TYPES = EDGE_CATEGORY_MAP.domain;

const DEFAULT_FILTERS: FilterState = {
  nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
  complexities: new Set<Complexity>(["moderate", "complex"]),
  layerIds: new Set<string>(),
  edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
};

/** Categories used for node type filter toggles. Single source of truth for NodeCategory. */
export type NodeCategory = "code" | "config" | "docs" | "infra" | "data" | "domain" | "knowledge";

/** Find which layer a node belongs to. Returns layerId or null. */
function findNodeLayer(graph: KnowledgeGraph, nodeId: string): string | null {
  for (const layer of graph.layers) {
    if (layer.nodeIds.includes(nodeId)) return layer.id;
  }
  return null;
}

/** Maximum number of entries in the sidebar navigation history. */
const MAX_HISTORY = 50;

interface DashboardStore {
  graph: KnowledgeGraph | null;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchEngine: SearchEngine | null;
  searchMode: "fuzzy" | "semantic";
  setSearchMode: (mode: "fuzzy" | "semantic") => void;

  // Lens navigation
  navigationLevel: NavigationLevel;
  activeLayerId: string | null;
  activeDirPrefix: string | null;

  codeViewerOpen: boolean;
  codeViewerNodeId: string | null;

  diffMode: boolean;
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;

  // Focus mode: isolate a node's 1-hop neighborhood
  focusNodeId: string | null;

  // Sidebar navigation history (stack of visited node IDs)
  nodeHistory: string[];

  // Filter & Export features
  filters: FilterState;
  filterPanelOpen: boolean;
  exportMenuOpen: boolean;
  pathFinderOpen: boolean;
  reactFlowInstance: ReactFlowInstance | null;

  // Node type category filters
  nodeTypeFilters: Record<NodeCategory, boolean>;
  toggleNodeTypeFilter: (category: NodeCategory) => void;

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  navigateToNodeInLayer: (nodeId: string) => void;
  navigateToHistoryIndex: (index: number) => void;
  goBackNode: () => void;
  drillIntoLayer: (layerId: string) => void;
  drillIntoDirPrefix: (prefix: string) => void;
  navigateToDirOverview: () => void;
  navigateToOverview: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
  openCodeViewer: (nodeId: string) => void;
  closeCodeViewer: () => void;

  setDiffOverlay: (changed: string[], affected: string[]) => void;
  toggleDiffMode: () => void;
  clearDiffOverlay: () => void;

  toggleFilterPanel: () => void;
  toggleExportMenu: () => void;
  togglePathFinder: () => void;
  setReactFlowInstance: (instance: ReactFlowInstance | null) => void;
  setFilters: (filters: Partial<FilterState>) => void;
  resetFilters: () => void;
  hasActiveFilters: () => boolean;

  // View mode
  viewMode: ViewMode;
  isKnowledgeGraph: boolean;
  domainGraph: KnowledgeGraph | null;
  activeDomainId: string | null;

  setDomainGraph: (graph: KnowledgeGraph) => void;
  setViewMode: (mode: ViewMode) => void;
  setIsKnowledgeGraph: (value: boolean) => void;
  navigateToDomain: (domainId: string) => void;
  clearActiveDomain: () => void;

  // SI tracing state
  siGraph: KnowledgeGraph | null;
  siViewActive: boolean;
  selectedReqId: string | null;
  rtmCollapsed: boolean;
  commandLog: Array<{ runId: string; lines: string[]; done: boolean; exitCode?: number }>;

  // SI tracing actions
  setSiGraph: (graph: KnowledgeGraph | null) => void;
  setSiViewActive: (active: boolean) => void;
  setSelectedReqId: (reqId: string | null) => void;
  setRtmCollapsed: (collapsed: boolean) => void;
  appendCommandLog: (runId: string, line: string) => void;
  completeCommandLog: (runId: string, code: number) => void;

  // Multi-source graph selector (P0-1)
  sourceLabels: string[];
  selectedSourceLabel: string | null;
  setSourceLabels: (labels: string[]) => void;
  setSelectedSourceLabel: (label: string | null) => void;

  // 스펙 문서 목록 (NodeInfo ���동)
  infList: Array<{ infId: string; domain: string; path: string }>;
  uisList: Array<{ uisId: string; domain: string; path: string; route?: string; previewHtmlPath?: string; previewPngPath?: string }>;
  srsList: Array<{ srsId: string; domain: string; path: string; title?: string }>;
  setInfList: (list: Array<{ infId: string; domain: string; path: string }>) => void;
  setUisList: (list: Array<{ uisId: string; domain: string; path: string; route?: string; previewHtmlPath?: string; previewPngPath?: string }>) => void;
  setSrsList: (list: Array<{ srsId: string; domain: string; path: string; title?: string }>) => void;

  // SDD 방향 B — RTM 파싱 + linked_req 역인덱스 (GENESIS)
  parsedRTM: Array<{
    id: string; title: string;
    srs: string[]; inf: string[]; sch: string[]; uis: string[]; tc: string[];
  }> | null;
  reqImplMap: Record<string, Array<{ file: string; line: number; label: string }>> | null;
  setParsedRTM: (data: DashboardStore["parsedRTM"]) => void;
  setReqImplMap: (data: DashboardStore["reqImplMap"]) => void;

  // RECON 모드 — FUNC-ID 커버리지
  funcMap: Array<{
    id: string; description: string;
    srs: string[]; inf: string[]; sch: string[]; uis: string[];
  }> | null;
  linkedFuncMap: Record<string, Array<{ file: string; line: number; label: string }>> | null;
  setFuncMap: (data: DashboardStore["funcMap"]) => void;
  setLinkedFuncMap: (data: DashboardStore["linkedFuncMap"]) => void;

  // MCP 연결 상태 (P1-4)
  mcpStatus: Record<string, string> | null;
  setMcpStatus: (status: Record<string, string> | null) => void;

  // Recon 진행상황 (P1-3)
  reconProgress: Array<{ domain: string; infCount: number; schCount: number; uiCount: number }> | null;
  setReconProgress: (data: Array<{ domain: string; infCount: number; schCount: number; uiCount: number }> | null) => void;
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],
  searchEngine: null,
  searchMode: "fuzzy",

  navigationLevel: "overview",
  activeLayerId: null,
  activeDirPrefix: null,
  codeViewerOpen: false,
  codeViewerNodeId: null,

  diffMode: false,
  changedNodeIds: new Set<string>(),
  affectedNodeIds: new Set<string>(),

  focusNodeId: null,
  nodeHistory: [],

  filters: { ...DEFAULT_FILTERS, nodeTypes: new Set(DEFAULT_FILTERS.nodeTypes), complexities: new Set(DEFAULT_FILTERS.complexities), layerIds: new Set(DEFAULT_FILTERS.layerIds), edgeCategories: new Set(DEFAULT_FILTERS.edgeCategories) },
  filterPanelOpen: false,
  exportMenuOpen: false,
  pathFinderOpen: false,
  reactFlowInstance: null,

  nodeTypeFilters: { code: true, config: true, docs: true, infra: true, data: true, domain: true, knowledge: true },

  toggleNodeTypeFilter: (category) =>
    set((state) => ({
      nodeTypeFilters: {
        ...state.nodeTypeFilters,
        [category]: !state.nodeTypeFilters[category],
      },
    })),

  setGraph: (graph) => {
    const searchEngine = new SearchEngine(graph.nodes);
    const query = get().searchQuery;
    const searchResults = query.trim() ? searchEngine.search(query) : [];
    const { viewMode, domainGraph, activeDomainId } = get();
    // Preserve domain view if a domain graph is already loaded
    const keepDomainView = viewMode === "domain" && domainGraph !== null;
    set({
      graph,
      searchEngine,
      searchResults,
      navigationLevel: "overview",
      activeLayerId: null,
      selectedNodeId: null,
      focusNodeId: null,
      nodeHistory: [],
      viewMode: keepDomainView ? "domain" as const : "structural" as const,
      activeDomainId: keepDomainView ? activeDomainId : null,
    });
  },

  selectNode: (nodeId) => {
    const { selectedNodeId, nodeHistory } = get();
    if (nodeId && selectedNodeId && nodeId !== selectedNodeId) {
      // Push current node to history before navigating away
      set({
        selectedNodeId: nodeId,
        nodeHistory: [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY),
      });
    } else {
      set({ selectedNodeId: nodeId });
    }
  },

  navigateToNode: (nodeId) => {
    get().navigateToNodeInLayer(nodeId);
  },

  navigateToNodeInLayer: (nodeId) => {
    const { graph, selectedNodeId, nodeHistory } = get();
    if (!graph) return;
    const layerId = findNodeLayer(graph, nodeId);
    const newHistory =
      selectedNodeId && nodeId !== selectedNodeId
        ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
        : nodeHistory;
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: nodeId,
        focusNodeId: null,
        codeViewerOpen: false,
        codeViewerNodeId: null,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: nodeId,
        nodeHistory: newHistory,
      });
    }
  },

  navigateToHistoryIndex: (index) => {
    const { nodeHistory, graph } = get();
    if (!graph || index < 0 || index >= nodeHistory.length) return;
    const targetId = nodeHistory[index];
    const newHistory = nodeHistory.slice(0, index);
    const layerId = findNodeLayer(graph, targetId);
    set({
      selectedNodeId: targetId,
      nodeHistory: newHistory,
      ...(layerId ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId } : {}),
    });
  },

  goBackNode: () => {
    const { nodeHistory, graph } = get();
    if (nodeHistory.length === 0 || !graph) return;
    const prevNodeId = nodeHistory[nodeHistory.length - 1];
    const newHistory = nodeHistory.slice(0, -1);
    const layerId = findNodeLayer(graph, prevNodeId);
    if (layerId) {
      set({
        navigationLevel: "layer-detail",
        activeLayerId: layerId,
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    } else {
      set({
        selectedNodeId: prevNodeId,
        nodeHistory: newHistory,
      });
    }
  },

  drillIntoLayer: (layerId) =>
    set({
      navigationLevel: "layer-detail",
      activeLayerId: layerId,
      activeDirPrefix: null,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
    }),

  drillIntoDirPrefix: (prefix) =>
    set({
      activeDirPrefix: prefix,
      selectedNodeId: null,
      focusNodeId: null,
    }),

  navigateToDirOverview: () =>
    set({
      activeDirPrefix: null,
      selectedNodeId: null,
      focusNodeId: null,
    }),

  navigateToOverview: () =>
    set({
      navigationLevel: "overview",
      activeLayerId: null,
      activeDirPrefix: null,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
    }),

  setFocusNode: (nodeId) => set({ focusNodeId: nodeId, selectedNodeId: nodeId }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchQuery: (query) => {
    const engine = get().searchEngine;
    const mode = get().searchMode;
    if (!engine || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }
    // Currently both modes use the same fuzzy engine
    // When embeddings are available, "semantic" mode will use SemanticSearchEngine
    void mode;
    const searchResults = engine.search(query);
    set({ searchQuery: query, searchResults });
  },

  openCodeViewer: (nodeId) => set({ codeViewerOpen: true, codeViewerNodeId: nodeId }),
  closeCodeViewer: () => set({ codeViewerOpen: false, codeViewerNodeId: null }),

  setDiffOverlay: (changed, affected) =>
    set({
      diffMode: true,
      changedNodeIds: new Set(changed),
      affectedNodeIds: new Set(affected),
    }),

  toggleDiffMode: () => set((state) => ({ diffMode: !state.diffMode })),

  clearDiffOverlay: () =>
    set({
      diffMode: false,
      changedNodeIds: new Set<string>(),
      affectedNodeIds: new Set<string>(),
    }),

  toggleFilterPanel: () => set((state) => ({
    filterPanelOpen: !state.filterPanelOpen,
    exportMenuOpen: false,
  })),

  toggleExportMenu: () => set((state) => ({
    exportMenuOpen: !state.exportMenuOpen,
    filterPanelOpen: false,
  })),

  togglePathFinder: () => set((state) => ({
    pathFinderOpen: !state.pathFinderOpen,
  })),

  setReactFlowInstance: (instance) => set({ reactFlowInstance: instance }),

  setFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters },
  })),

  resetFilters: () => set({
    filters: {
      nodeTypes: new Set<NodeType>(ALL_NODE_TYPES),
      complexities: new Set<Complexity>(ALL_COMPLEXITIES),
      layerIds: new Set<string>(),
      edgeCategories: new Set<EdgeCategory>(ALL_EDGE_CATEGORIES),
    },
  }),

  hasActiveFilters: () => {
    const { filters } = get();
    return filters.nodeTypes.size !== ALL_NODE_TYPES.length
      || filters.complexities.size !== ALL_COMPLEXITIES.length
      || filters.layerIds.size > 0
      || filters.edgeCategories.size !== ALL_EDGE_CATEGORIES.length;
  },

  viewMode: "structural",
  isKnowledgeGraph: false,
  domainGraph: null,
  activeDomainId: null,

  setDomainGraph: (graph) => {
    set({ domainGraph: graph });
  },

  setIsKnowledgeGraph: (value) => {
    set({ isKnowledgeGraph: value });
  },

  setViewMode: (mode) => {
    set({
      viewMode: mode,
      selectedNodeId: null,
      focusNodeId: null,
      codeViewerOpen: false,
      codeViewerNodeId: null,
    });
  },

  navigateToDomain: (domainId) => {
    const { selectedNodeId, nodeHistory } = get();
    const newHistory = selectedNodeId
      ? [...nodeHistory, selectedNodeId].slice(-MAX_HISTORY)
      : nodeHistory;
    set({
      viewMode: "domain" as const,
      activeDomainId: domainId,
      focusNodeId: null,
      nodeHistory: newHistory,
    });
  },

  clearActiveDomain: () => {
    set({
      activeDomainId: null,
      selectedNodeId: null,
      focusNodeId: null,
    });
  },

  // SI tracing initial state
  siGraph: null,
  siViewActive: false,
  selectedReqId: null,
  rtmCollapsed: true,
  commandLog: [],

  // SI tracing actions
  setSiGraph: (siGraph) => set({ siGraph }),
  setSiViewActive: (siViewActive) => set({ siViewActive }),
  setSelectedReqId: (selectedReqId) => set({ selectedReqId }),
  setRtmCollapsed: (rtmCollapsed) => set({ rtmCollapsed }),
  appendCommandLog: (runId, line) => set((state) => {
    const existing = state.commandLog.find(l => l.runId === runId);
    if (existing) {
      return { commandLog: state.commandLog.map(l =>
        l.runId === runId ? { ...l, lines: [...l.lines, line] } : l
      )};
    }
    return { commandLog: [...state.commandLog, { runId, lines: [line], done: false }] };
  }),
  completeCommandLog: (runId, code) => set((state) => ({
    commandLog: state.commandLog.map(l =>
      l.runId === runId ? { ...l, done: true, exitCode: code } : l
    ),
  })),

  // Multi-source graph selector (P0-1)
  sourceLabels: [],
  selectedSourceLabel: null,
  setSourceLabels: (sourceLabels) => set({ sourceLabels }),
  setSelectedSourceLabel: (selectedSourceLabel) => set({ selectedSourceLabel }),

  // 스펙 문서 목록
  infList: [],
  uisList: [],
  srsList: [],
  setInfList: (infList) => set({ infList }),
  setUisList: (uisList) => set({ uisList }),
  setSrsList: (srsList) => set({ srsList }),

  // SDD 방향 B (GENESIS)
  parsedRTM: null,
  reqImplMap: null,
  setParsedRTM: (parsedRTM) => set({ parsedRTM }),
  setReqImplMap: (reqImplMap) => set({ reqImplMap }),

  // RECON 모드 FUNC-ID
  funcMap: null,
  linkedFuncMap: null,
  setFuncMap: (funcMap) => set({ funcMap }),
  setLinkedFuncMap: (linkedFuncMap) => set({ linkedFuncMap }),

  // MCP 상태 (P1-4)
  mcpStatus: null,
  setMcpStatus: (mcpStatus) => set({ mcpStatus }),

  // Recon 진행상황 (P1-3)
  reconProgress: null,
  setReconProgress: (reconProgress) => set({ reconProgress }),
}));
