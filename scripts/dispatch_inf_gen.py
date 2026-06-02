#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dispatch_inf_gen.py - sl-recon STEP 4-3 외부 배치 디스패처

컨텍스트 폭발 방지:
  각 배치 그룹을 독립된 `claude -p` subprocess로 실행한다.
  메인 오케스트레이터 컨텍스트에 배치 결과가 쌓이지 않는다.

사용법:
  python dispatch_inf_gen.py [workspace_path]
  workspace_path 생략 시 현재 디렉토리 사용

전제 조건:
  - _tmp/router_inventory_with_chain.json 존재
  - project.env에 PLUGIN_PATH 설정
  - claude CLI PATH에 존재 (`claude --version` 으로 확인)
"""

import json
import os
import sys
import subprocess
import time
import signal
from pathlib import Path

# Windows cp949 환경에서 UTF-8 출력 강제
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


BATCH_TIMEOUT   = 600   # 배치당 최대 10분
MODEL           = "claude-sonnet-4-6"
MAX_PARALLEL    = 1     # POC: 순차 실행 (컨텍스트 격리 검증 우선)
LOG_DIR_NAME    = "_tmp/dispatch_logs"
STATUS_FILE     = "_tmp/dispatch_status.json"


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
    ap = Path(plugin_path) / "agents" / "ddd-api-agent.md"
    if ap.exists():
        return ap.read_text(encoding="utf-8")
    print(f"[WARN] ddd-api-agent.md 없음: {ap}")
    return ""


def build_prompt(group: list, workspace: str, agent_md: str) -> str:
    """배치 그룹 1개에 대한 claude 프롬프트를 생성한다."""
    g0 = group[0]

    # 처리 파일 목록
    file_lines = ["처리 대상 파일 목록 (여러 파일 한 번에 처리):"]
    for item in group:
        file_lines.append(
            f"- {item['filePath']} "
            f"→ INF-{item['domainCode']}-{item['infIdStart']:03d} 부터 순번 채번"
        )

    # 연관 파일 (call chain)
    related_lines = ["=== 사전 계산된 연관 파일 (읽기 의무) ==="]
    for i, item in enumerate(group):
        rf = item.get("relatedFiles", {})
        related_lines.append(f"\n[파일{i+1} 연관]")
        related_lines.append(f"서비스: {rf.get('service') or '없음'}")
        related_lines.append(f"DAO:    {rf.get('dao') or '없음'}")
        related_lines.append(f"쿼리:   {rf.get('query') or '없음'}")
        if rf.get("querySchemas"):
            related_lines.append(f"스키마(사전추출): {json.dumps(rf['querySchemas'], ensure_ascii=False)}")

    # API routes
    routes_lines = [
        "=== API Routes (INF 생성 대상 - kind=form 라우트 이미 제외됨) ===",
        "⚠️ 아래 routes만 INF로 생성할 것. 목록 외 라우트는 무시.",
    ]
    for i, item in enumerate(group):
        routes = item.get("apiRoutes", [])
        routes_str = (
            json.dumps(routes, ensure_ascii=False)
            if routes
            else "전체 api routes"
        )
        routes_lines.append(f"파일{i+1}: {routes_str}")

    task_section = "\n".join(
        file_lines
        + [
            f"도메인: {g0['domain']}",
            f"도메인 코드: {g0['domainCode']}",
            f"도메인 설명: {g0.get('domainDescription', '')}",
            f"관련 레이어: {g0.get('layer', '')}",
            f"MODE: RECON",
            f"워크스페이스: {workspace}",
            "",
        ]
        + related_lines
        + [""]
        + routes_lines
    )

    # agent 지침 + 실행 입력 결합
    return f"{agent_md}\n\n---\n\n{task_section}\n"


def group_already_done(group: list, workspace: str) -> bool:
    """그룹 내 첫 파일 기준으로 INF가 이미 존재하면 True."""
    for item in group:
        inf_dir = (
            Path(workspace) / "docs" / "05_설계서" / item["domain"] / "INF"
        )
        if not inf_dir.exists():
            return False
        basename = Path(item["filePath"]).stem.lower()
        for f in inf_dir.glob("INF-*.md"):
            try:
                if basename in f.read_text(encoding="utf-8", errors="ignore").lower():
                    return True
            except OSError:
                pass
    return False


def run_batch(
    prompt: str,
    workspace: str,
    batch_idx: int,
    log_dir: Path,
) -> tuple[bool, str]:
    """단일 배치를 claude subprocess로 실행한다. (ok, message) 반환."""
    log_file = log_dir / f"batch_{batch_idx:03d}.log"

    cmd = [
        "claude",
        "--print",
        "--dangerously-skip-permissions",
        "--model", MODEL,
    ]

    try:
        with open(log_file, "w", encoding="utf-8") as lf:
            result = subprocess.run(
                cmd,
                input=prompt,
                cwd=workspace,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=BATCH_TIMEOUT,
            )
        if result.returncode == 0:
            return True, f"로그: {log_file}"
        else:
            tail = _tail(log_file, 10)
            return False, f"exit={result.returncode}\n{tail}"

    except subprocess.TimeoutExpired:
        return False, f"TIMEOUT ({BATCH_TIMEOUT}s)"

    except FileNotFoundError:
        return False, "claude CLI를 찾을 수 없음 (PATH 확인)"


def _tail(path: Path, n: int) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        return "\n".join(lines[-n:])
    except OSError:
        return ""


def load_status(workspace: str) -> dict:
    sp = Path(workspace) / STATUS_FILE
    if sp.exists():
        try:
            return json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"done": [], "failed": []}


def save_status(workspace: str, status: dict) -> None:
    sp = Path(workspace) / STATUS_FILE
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args():
    """간단한 CLI 파싱.
    사용법:
      dispatch_inf_gen.py [workspace] [--inventory path/to/inventory.json]
    """
    args = sys.argv[1:]
    workspace = os.getcwd()
    inv_override = None
    i = 0
    while i < len(args):
        if args[i] == "--inventory" and i + 1 < len(args):
            inv_override = args[i + 1]
            i += 2
        elif not args[i].startswith("--"):
            workspace = str(Path(args[i]).resolve())
            i += 1
        else:
            i += 1
    return workspace, inv_override


def main() -> int:
    workspace, inv_override = parse_args()
    print(f"dispatch_inf_gen - 워크스페이스: {workspace}")

    # 환경 로드
    env = load_env(workspace)
    plugin_path = env.get("PLUGIN_PATH", "")
    if not plugin_path:
        print("[WARN] PLUGIN_PATH 미설정 - ddd-api-agent.md 없이 실행")
    agent_md = load_agent_md(plugin_path) if plugin_path else ""

    # inventory 로드
    if inv_override:
        inv_path = Path(inv_override)
    else:
        inv_path = Path(workspace) / "_tmp" / "router_inventory_with_chain.json"
    if not inv_path.exists():
        print(f"[ERROR] {inv_path} 없음 - STEP 4-2까지 완료 후 실행")
        return 1

    print(f"inventory: {inv_path}")
    inventory: list[list[dict]] = json.loads(inv_path.read_text(encoding="utf-8"))
    total = len(inventory)
    api_files = sum(len(g) for g in inventory)
    print(f"그룹: {total}개 / 파일: {api_files}개\n")

    # 로그 디렉토리 + 상태 파일
    log_dir = Path(workspace) / LOG_DIR_NAME
    log_dir.mkdir(parents=True, exist_ok=True)
    status = load_status(workspace)

    done_count = 0
    skipped = 0
    failed_list: list[int] = []

    t_total = time.time()

    for i, group in enumerate(inventory):
        if not group:
            continue

        g0 = group[0]
        names = " / ".join(Path(item["filePath"]).name for item in group)
        label = f"[{i+1:03d}/{total:03d}] {g0['domain']}({g0['domainCode']}) {names}"

        # 이미 성공한 배치 스킵
        if i in status.get("done", []):
            print(f"{label}  ⏭  (이전 실행 완료)")
            skipped += 1
            continue

        # INF 파일로 완료 감지 (재시작 지원)
        if group_already_done(group, workspace):
            print(f"{label}  ⏭  (INF 존재)")
            status.setdefault("done", []).append(i)
            save_status(workspace, status)
            skipped += 1
            continue

        print(f"{label}  ▶  실행 중...", flush=True)
        t0 = time.time()

        prompt = build_prompt(group, workspace, agent_md)
        ok, msg = run_batch(prompt, workspace, i, log_dir)
        elapsed = time.time() - t0

        if ok:
            print(f"{label}  ✔  완료 ({elapsed:.0f}s)  {msg}")
            status.setdefault("done", []).append(i)
            done_count += 1
        else:
            print(f"{label}  ✗  실패 ({elapsed:.0f}s)")
            print(f"     {msg}")
            status.setdefault("failed", []).append(i)
            failed_list.append(i)

        save_status(workspace, status)

    total_elapsed = time.time() - t_total
    print()
    print("=" * 60)
    print(
        f"완료: 생성 {done_count} / 스킵 {skipped} / "
        f"실패 {len(failed_list)} / 전체 {total}  "
        f"({total_elapsed:.0f}s)"
    )
    if failed_list:
        print(f"실패 배치 인덱스: {failed_list}")
        print(f"로그 위치: {log_dir}")
    print("=" * 60)

    return 1 if failed_list else 0


if __name__ == "__main__":
    sys.exit(main())
