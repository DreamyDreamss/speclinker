import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 120;
export const LAYER_CLUSTER_WIDTH = 320;
export const LAYER_CLUSTER_HEIGHT = 180;
export const PORTAL_NODE_WIDTH = 240;
export const PORTAL_NODE_HEIGHT = 80;
export const DIR_CLUSTER_NODE_WIDTH = 240;
export const DIR_CLUSTER_NODE_HEIGHT = 110;

/**
 * Synchronous dagre layout — used for small graphs.
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  nodeDimensions?: Map<string, { width: number; height: number }>,
  spacingOverrides?: { nodesep?: number; ranksep?: number },
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  // Scale spacing for larger graphs to reduce overlap
  const isLarge = nodes.length > 50;
  g.setGraph({
    rankdir: direction,
    nodesep: spacingOverrides?.nodesep ?? (isLarge ? 80 : 60),
    ranksep: spacingOverrides?.ranksep ?? (isLarge ? 120 : 80),
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((node) => {
    const dims = nodeDimensions?.get(node.id);
    const w = dims?.width ?? NODE_WIDTH;
    const h = dims?.height ?? NODE_HEIGHT;
    g.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return { ...node, position: { x: 0, y: 0 } };
    const dims = nodeDimensions?.get(node.id);
    const w = dims?.width ?? NODE_WIDTH;
    const h = dims?.height ?? NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}



