import { useDashboardStore } from "../store";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "@understand-anything/core/types";

interface RTMRow {
  reqId: string;
  reqName: string;
  srsId?: string;
  uisId?: string;
  infId?: string;
  schId?: string;
  codeFile?: string;
  tcId?: string;
  status: string;
}

function buildRTMRows(siGraph: KnowledgeGraph): RTMRow[] {
  const rows: RTMRow[] = [];
  const reqNodes = siGraph.nodes.filter((n: GraphNode) => n.type === "req");

  for (const req of reqNodes) {
    const reqId = req.siMeta?.reqId ?? req.name;

    const linked = (type: string, srcId: string, edgeType: string) =>
      siGraph.edges
        .filter((e: GraphEdge) => e.type === edgeType && e.source === srcId)
        .map((e: GraphEdge) => siGraph.nodes.find((n: GraphNode) => n.id === e.target && n.type === type))
        .find((n): n is GraphNode => n !== undefined);

    const srsNode = linked("srs", req.id, "traces_to");
    const uisNode = linked("uis", req.id, "traces_to");
    const infNode = uisNode ? linked("inf", uisNode.id, "calls") : undefined;
    const schNode = infNode ? linked("sch", infNode.id, "reads_from") : undefined;

    const satisfiesEdge = siGraph.edges.find(
      (e: GraphEdge) => e.type === "satisfies" && e.target === req.id
    );
    const codeNode = satisfiesEdge
      ? siGraph.nodes.find((n: GraphNode) => n.id === satisfiesEdge.source)
      : undefined;

    const tcNode = siGraph.nodes.find(
      (n: GraphNode) => n.type === "tc" && n.siMeta?.linkedReqId === reqId
    );

    rows.push({
      reqId,
      reqName: req.name,
      srsId: srsNode?.siMeta?.reqId ?? srsNode?.name,
      uisId: uisNode?.siMeta?.reqId ?? uisNode?.name,
      infId: infNode?.siMeta?.reqId ?? infNode?.name,
      schId: schNode?.siMeta?.reqId ?? schNode?.name,
      codeFile: codeNode?.filePath?.split("/").pop(),
      tcId: tcNode?.siMeta?.reqId ?? tcNode?.name,
      status: req.siMeta?.status ?? "⬜ 미착수",
    });
  }

  return rows;
}

export default function RTMPanel() {
  const { siGraph, setSelectedReqId, selectedReqId, rtmCollapsed, setRtmCollapsed } = useDashboardStore();

  if (!siGraph) {
    return (
      <div className="p-2 text-xs text-gray-500 border-t border-gray-700">
        RTM 없음 — /spec-create 실행 후 표시됩니다.
      </div>
    );
  }

  const rows = buildRTMRows(siGraph);
  if (rows.length === 0) return null;

  const total = rows.length;
  const done = rows.filter(r => r.status === "✅ 완료").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="bg-gray-900 border-t border-gray-700 text-gray-100">
      {/* 헤더 */}
      <button
        onClick={() => setRtmCollapsed(!rtmCollapsed)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-800"
      >
        <span className="font-medium">RTM 트레이서빌리티 — {done}/{total} ({pct}%)</span>
        <span>{rtmCollapsed ? "▲" : "▼"}</span>
      </button>

      {/* 테이블 */}
      {!rtmCollapsed && (
        <div className="overflow-x-auto max-h-48">
          <table className="w-full text-[10px] border-collapse">
            <thead className="bg-gray-800 sticky top-0">
              <tr>
                {["REQ-ID","요구사항","SRS-ID","UIS-ID","INF-ID","SCH-ID","코드 파일","TC-ID","상태"].map(h => (
                  <th key={h} className="px-2 py-1 text-left text-gray-400 whitespace-nowrap border-b border-gray-700">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.reqId}
                  onClick={() => setSelectedReqId(row.reqId === selectedReqId ? null : row.reqId)}
                  className={`cursor-pointer border-b border-gray-800 hover:bg-gray-800 ${
                    row.reqId === selectedReqId ? "bg-purple-900" : ""
                  }`}
                >
                  <td className="px-2 py-1 font-mono text-purple-400 whitespace-nowrap">{row.reqId}</td>
                  <td className="px-2 py-1 text-gray-300 max-w-[120px] truncate">{row.reqName}</td>
                  <td className="px-2 py-1 font-mono text-blue-400 whitespace-nowrap">{row.srsId ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-orange-400 whitespace-nowrap">{row.uisId ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-teal-400 whitespace-nowrap">{row.infId ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-green-400 whitespace-nowrap">{row.schId ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-gray-300 max-w-[100px] truncate">{row.codeFile ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-gray-400 whitespace-nowrap">{row.tcId ?? "—"}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
