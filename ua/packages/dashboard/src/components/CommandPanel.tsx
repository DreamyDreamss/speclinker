import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store";

interface Command {
  label: string;
  cmd: string;
  icon: string;
  description: string;
}

const COMMANDS: Command[] = [
  { label: "요구사항 생성",  cmd: "/spec-create",         icon: "📝", description: "인터뷰 파일 → RD/SRS/SAD/DDD" },
  { label: "코드 생성",      cmd: "/develop",              icon: "💻", description: "DDD 설계서 → 소스코드 생성" },
  { label: "테스트 실행",    cmd: "/test",                 icon: "🧪", description: "TC 작성 → 실행 → TR 생성" },
  { label: "그래프 갱신",    cmd: "/develop --ua-update",  icon: "🔄", description: "UA knowledge graph 재생성" },
  { label: "RTM 동기화",     cmd: "/develop --sync-rtm",   icon: "📊", description: "linked_req 스캔 → RTM 업데이트" },
];

export default function CommandPanel() {
  const { commandLog, appendCommandLog, completeCommandLog } = useDashboardStore();
  const [running, setRunning] = useState<string | null>(null);
  const [customCmd, setCustomCmd] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // SSE 연결
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; runId?: string; data?: string; code?: number };
        if (msg.type === "log" && msg.runId && msg.data !== undefined) {
          appendCommandLog(msg.runId, msg.data);
        } else if (msg.type === "done" && msg.runId) {
          completeCommandLog(msg.runId, msg.code ?? -1);
          setRunning(null);
        }
      } catch {
        // JSON 파싱 오류 무시
      }
    };
    return () => es.close();
  }, [appendCommandLog, completeCommandLog]);

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [commandLog]);

  const runCommand = async (cmd: string) => {
    if (running || !cmd.trim()) return;
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      if (res.ok) {
        const { runId } = await res.json() as { runId: string };
        setRunning(runId);
        appendCommandLog(runId, `▶ claude ${cmd}\n`);
      }
    } catch {
      // 네트워크 오류 무시
    }
  };

  const latestLog = commandLog[commandLog.length - 1] as
    | (typeof commandLog[number] & { exitCode?: number })
    | undefined;

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* 커맨드 버튼 */}
      <div className="p-2 border-b border-gray-700 flex flex-col gap-1">
        {COMMANDS.map(cmd => (
          <button
            key={cmd.cmd}
            onClick={() => runCommand(cmd.cmd)}
            disabled={!!running}
            className="text-left px-2 py-2 rounded text-xs flex items-start gap-2 hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <span className="mt-0.5">{cmd.icon}</span>
            <div>
              <div className="font-medium text-gray-100">{cmd.label}</div>
              <div className="text-gray-400 text-[10px]">{cmd.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* 커스텀 커맨드 입력 */}
      <div className="p-2 border-b border-gray-700 flex gap-1">
        <input
          value={customCmd}
          onChange={e => setCustomCmd(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") runCommand(customCmd); }}
          placeholder="/spec-create 00_input/..."
          className="flex-1 bg-gray-800 text-xs text-gray-100 px-2 py-1 rounded border border-gray-600 outline-none focus:border-purple-500"
        />
        <button
          onClick={() => runCommand(customCmd)}
          disabled={!!running || !customCmd.trim()}
          className="px-2 py-1 bg-purple-700 text-white text-xs rounded disabled:opacity-40 hover:bg-purple-600"
        >
          실행
        </button>
      </div>

      {/* 로그 출력 */}
      <div
        ref={logRef}
        className="flex-1 overflow-auto p-2 font-mono text-[10px] text-green-400 bg-black"
      >
        {latestLog ? (
          <>
            {latestLog.lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">{line}</div>
            ))}
            {latestLog.done && (
              <div className={`mt-1 font-bold ${latestLog.exitCode === 0 ? "text-green-500" : "text-red-500"}`}>
                {latestLog.exitCode === 0 ? "✓ 완료" : "✗ 오류 발생"}
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-600">커맨드 실행 로그가 여기 표시됩니다.</div>
        )}
        {running && (
          <div className="mt-1 text-yellow-400 animate-pulse">● 실행 중...</div>
        )}
      </div>
    </div>
  );
}
