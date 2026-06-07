#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dispatch_sch_gen.py - sl-recon STEP 5-B SCH enrichment 디스패처

build_sch_static.py가 만든 SCH 스켈레톤의 <!-- LLM-TODO --> 마커(코드값·비즈주의·컬럼설명)만
도메인 단위로 ddd-db-agent(enrichment 모드)에 위임한다.
각 도메인을 독립 `claude -p` subprocess로 실행 → 메인 컨텍스트에 SCH 본문 누적 없음.

사용법:
  python dispatch_sch_gen.py [workspace_path]

전제:
  - _tmp/sch_enrich_todo.json 존재 (build_sch_static 산출 — 코드성 컬럼/INF 비즈규칙 있는 도메인만)
  - 비어있으면 즉시 exit 0 (전부 정적으로 충분)
  - project.env PLUGIN_PATH, claude CLI PATH
"""
import json
import os
import sys
import subprocess
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BATCH_TIMEOUT  = 1800
MODEL          = os.environ.get("SL_DISPATCH_MODEL", "claude-haiku-4-5-20251001")
# L-4: Oracle MCP 동시접속(DPY-4011) 시 SL_DISPATCH_PARALLEL=2로 낮춘다.
# (각 서브프로세스가 자체 MCP 서버=별도 DB 커넥션을 열어 동시 부하가 커짐. MCP _query엔 재접속 재시도 내장.)
MAX_PARALLEL   = int(os.environ.get("SL_DISPATCH_PARALLEL", "3"))
LAUNCH_STAGGER = 3
LOG_DIR_NAME   = "_tmp/sch_dispatch_logs"
STATUS_FILE    = "_tmp/sch_dispatch_status.json"


def load_env(workspace: str) -> dict:
    env = {}
    ep = Path(workspace) / "project.env"
    if ep.exists():
        for line in ep.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def load_agent_md(plugin_path: str) -> str:
    ap = Path(plugin_path) / "agents" / "ddd-db-agent.md"
    if ap.exists():
        return ap.read_text(encoding="utf-8")
    print(f"[WARN] ddd-db-agent.md 없음: {ap}")
    return ""


def build_prompt(entry: dict, workspace: str, agent_md: str) -> str:
    name = entry["name"]
    code = entry.get("code", "")
    task = f"""---

enrichment 모드: 아래 도메인의 스켈레톤 SCH 파일에서 <!-- LLM-TODO --> 마커만 채운다.

도메인: {name}
도메인 코드: {code}
워크스페이스: {workspace}
대상 파일: docs/05_설계서/{name}/SCH/SCH-{code}-*.md (build_sch_static가 이미 생성)

채울 것 (마커가 있는 곳만):
- ### 코드값 : 코드성 컬럼(_CD/_TP/_STS/_YN/_FL/_GB/_DIV)의 값·의미 표. 근거 없으면 마커 줄 삭제(섹션 비움).
- ### 비즈니스 주의사항 : 참조 INF의 ## 비즈니스 규칙/트랜잭션 순서/사이드이펙트 + sch_draft evidence 기반.
- 컬럼표('| 컬럼명 | 타입 | NULL | 키 | 기본값 | 설명 |') '설명' 칸의 <!-- LLM-TODO --> : 컬럼 한글 설명.
- 컬럼표 타입·NULL·기본값 칸의 <!-- LLM-TODO -->/⚠️추론, ### 관계 FK '참조 컬럼' 빈칸 : 환경에 맞는 DB MCP describe/get_foreign_keys로 사실 채움(미연결 시 유지).
- 🔧 쿼리 작성 가이드(상시 필터) 표 '의미' 칸의 <!-- LLM-TODO --> : 술어 의미(예: DEL_YN='N'→soft-delete 제외, COMP_CD→법인 스코프). 근거 없으면 [미확인].

절대 수정 금지 (읽기 전용):
- frontmatter(sch-id/table/domain/domain-code/inf), 상단 크로스링크 블록
- DDL, ### 인덱스, ### mini-ERD, ### 관계의 관찰조인 행(출처=쿼리관찰)·이미 채워진 DB FK 행, 컬럼표 '키'(PK/FK)

근거 소스: 각 SCH의 inf: frontmatter가 가리키는 docs/05_설계서/{name}/INF/INF-*.md 본문 + sch_draft evidence.
한 SCH 파일을 채우면 다음 파일로. 도메인 내 모든 SCH 파일을 처리한다.
"""
    return f"{agent_md}\n\n{task}\n"


def run_batch(prompt, workspace, idx, log_dir):
    log_file = log_dir / f"sch_{idx:03d}.log"
    cmd = ["claude", "--print", "--dangerously-skip-permissions", "--model", MODEL]
    try:
        with open(log_file, "w", encoding="utf-8") as lf:
            result = subprocess.run(
                cmd, input=prompt, cwd=workspace, stdout=lf,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", timeout=BATCH_TIMEOUT)
        if result.returncode == 0:
            return True, f"로그: {log_file}"
        return False, f"exit={result.returncode}\n{_tail(log_file, 10)}"
    except subprocess.TimeoutExpired:
        return False, f"TIMEOUT ({BATCH_TIMEOUT}s)"
    except FileNotFoundError:
        return False, "claude CLI를 찾을 수 없음 (PATH 확인)"


def _tail(path, n):
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="ignore").splitlines()[-n:])
    except OSError:
        return ""


def load_status(workspace):
    sp = Path(workspace) / STATUS_FILE
    if sp.exists():
        try:
            return json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"done": [], "failed": []}


def save_status(workspace, status):
    sp = Path(workspace) / STATUS_FILE
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    workspace = str(Path(sys.argv[1]).resolve()) if len(sys.argv) > 1 else os.getcwd()
    print(f"dispatch_sch_gen - 워크스페이스: {workspace}")

    todo_path = Path(workspace) / "_tmp" / "sch_enrich_todo.json"
    if not todo_path.exists():
        print("sch_enrich_todo.json 없음 — enrichment 대상 없음 (정적 생성으로 충분)")
        return 0
    todo = json.loads(todo_path.read_text(encoding="utf-8"))
    if not todo:
        print("enrichment 대상 없음 — 전부 정적으로 충분")
        return 0

    env = load_env(workspace)
    plugin_path = env.get("PLUGIN_PATH", "")
    agent_md = load_agent_md(plugin_path) if plugin_path else ""

    log_dir = Path(workspace) / LOG_DIR_NAME
    log_dir.mkdir(parents=True, exist_ok=True)
    status = load_status(workspace)

    # C-2 fix: enrich_todo가 바뀌면 인덱스 기반 done이 신규 도메인을 stale-skip한다.
    # SCH enrichment은 파일 존재 스캔으로 done 판정이 어려우므로 inventory_hash가 단일 가드.
    import hashlib
    inv_hash = hashlib.sha1(todo_path.read_bytes()).hexdigest()
    if status.get("inventory_hash") != inv_hash:
        if status.get("done") or status.get("failed"):
            print("[reset] enrich_todo 변경 감지 — done/failed 초기화")
        status = {"done": [], "failed": [], "inventory_hash": inv_hash}
        save_status(workspace, status)
    else:
        status.setdefault("inventory_hash", inv_hash)
    status_lock = threading.Lock()
    launch_lock = threading.Lock()
    last_launch = [0.0]

    pending = []
    skipped = 0
    for i, entry in enumerate(todo):
        if i in status.get("done", []):
            print(f"[{i+1:03d}/{len(todo):03d}] {entry['name']}  ⏭  (이전 완료)")
            skipped += 1
            continue
        pending.append((i, entry))

    print(f"스킵: {skipped} / 실행 대상: {len(pending)}  (병렬={MAX_PARALLEL})\n")
    done_count, failed_list = 0, []
    t_total = time.time()

    def run_one(args):
        i, entry = args
        label = f"[{i+1:03d}/{len(todo):03d}] {entry['name']}({entry.get('code','')})"
        with launch_lock:
            wait = last_launch[0] + LAUNCH_STAGGER - time.time()
            if wait > 0:
                time.sleep(wait)
            last_launch[0] = time.time()
        print(f"{label}  ▶  enrichment 중...", flush=True)
        t0 = time.time()
        prompt = build_prompt(entry, workspace, agent_md)
        ok, msg = run_batch(prompt, workspace, i, log_dir)
        return i, ok, msg, time.time() - t0, label

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
        futures = {ex.submit(run_one, a): a[0] for a in pending}
        for fut in as_completed(futures):
            i, ok, msg, elapsed, label = fut.result()
            if ok:
                print(f"{label}  ✔  완료 ({elapsed:.0f}s)  {msg}", flush=True)
                with status_lock:
                    status.setdefault("done", []).append(i)
                    done_count += 1
                    save_status(workspace, status)
            else:
                print(f"{label}  ✗  실패 ({elapsed:.0f}s)\n     {msg}", flush=True)
                with status_lock:
                    status.setdefault("failed", []).append(i)
                    failed_list.append(i)
                    save_status(workspace, status)

    print("\n" + "=" * 60)
    print(f"enrichment 완료: {done_count} / 스킵 {skipped} / 실패 {len(failed_list)} / 전체 {len(todo)}  ({time.time()-t_total:.0f}s)")
    if failed_list:
        print(f"실패 인덱스: {failed_list}  (재실행: python dispatch_sch_gen.py .)")
    print("=" * 60)
    return 1 if failed_list else 0


if __name__ == "__main__":
    sys.exit(main())
