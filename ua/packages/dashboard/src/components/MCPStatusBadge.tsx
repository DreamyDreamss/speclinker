import { useEffect } from "react";
import { useDashboardStore } from "../store";

export default function MCPStatusBadge() {
  const mcpStatus = useDashboardStore((s) => s.mcpStatus);
  const setMcpStatus = useDashboardStore((s) => s.setMcpStatus);

  useEffect(() => {
    fetch("/api/mcp-status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && typeof data === "object") setMcpStatus(data as Record<string, string>); })
      .catch(() => {});
  }, [setMcpStatus]);

  if (!mcpStatus || Object.keys(mcpStatus).length === 0) return null;

  const entries = Object.entries(mcpStatus);
  const connected = entries.filter(([, v]) => v === "connected").length;
  const total = entries.length;
  const allOk = connected === total;
  const anyOk = connected > 0;

  const dotCls = allOk
    ? "bg-emerald-400"
    : anyOk ? "bg-yellow-400"
    : "bg-red-400";

  return (
    <div className="relative group flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] cursor-default select-none">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
      <span className="text-text-muted font-mono">MCP {connected}/{total}</span>

      {/* Hover dropdown */}
      <div className="absolute top-full right-0 mt-1 hidden group-hover:block z-50 bg-surface border border-border-subtle rounded-lg shadow-xl min-w-[160px] py-1">
        <div className="px-3 py-1 text-[9px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle mb-1">
          MCP 서버 상태
        </div>
        {entries.map(([key, status]) => (
          <div key={key} className="flex items-center gap-2 px-3 py-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                status === "connected" ? "bg-emerald-400"
                : status === "failed"    ? "bg-red-400"
                : "bg-text-muted/40"
              }`}
            />
            <span className="text-[11px] text-text-secondary font-mono flex-1 truncate">{key}</span>
            <span className={`text-[9px] font-medium shrink-0 ${
              status === "connected" ? "text-emerald-400"
              : status === "failed"    ? "text-red-400"
              : "text-text-muted"
            }`}>
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
