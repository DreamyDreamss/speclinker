import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";

export interface DirClusterData extends Record<string, unknown> {
  dirPrefix: string;
  fileCount: number;
  aggregateComplexity: string;
  onDrillIn: (prefix: string) => void;
}

export type DirClusterFlowNode = Node<DirClusterData, "dir-cluster">;

const complexityColors: Record<string, string> = {
  simple: "#8aad8a",
  moderate: "#d4a574",
  complex: "#c97070",
};

function DirClusterNode({ data }: NodeProps<DirClusterFlowNode>) {
  const color = complexityColors[data.aggregateComplexity] ?? complexityColors.simple;

  return (
    <div
      className="relative rounded-xl bg-elevated border border-border-subtle overflow-hidden cursor-pointer transition-all duration-200 hover:border-gold/40 hover:shadow-lg group"
      style={{ width: 240, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}
      onClick={() => data.onDrillIn(data.dirPrefix)}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl"
        style={{ backgroundColor: color }}
      />
      <Handle type="target" position={Position.Top} className="!bg-text-muted !w-2 !h-2" />
      <div className="pl-5 pr-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Directory
          </span>
          <span className="text-[10px] font-mono" style={{ color }}>
            {data.aggregateComplexity}
          </span>
        </div>
        <div className="text-sm font-mono text-text-primary mb-2 truncate">
          {data.dirPrefix}/
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">
            {data.fileCount} file{data.fileCount !== 1 ? "s" : ""}
          </span>
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            Explore →
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-text-muted !w-2 !h-2" />
    </div>
  );
}

export default memo(DirClusterNode);
