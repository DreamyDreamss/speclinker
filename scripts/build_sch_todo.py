#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_sch_todo.py — SCH 생성 스킵 게이트 (sl-recon STEP 5-0)

도메인별로 "기대 테이블(INF tables: frontmatter 합집합)" 대비 "이미 생성된 SCH
(SCH-*.md frontmatter table:)"를 비교해, 생성 대상(누락 테이블이 있는) 도메인만
_tmp/sch_todo.json에 기록한다. 누락 0인 도메인은 스킵 → ddd-db-agent 미호출.

INF의 dispatch_inf_gen.group_already_done()과 동형 — recon 재실행 안전(idempotent).

Usage:
    python build_sch_todo.py [workspace]   (기본: 현재 디렉토리)
출력:
    _tmp/sch_todo.json = [{name, code, existing:[...], missing:[...]}]  (생성 대상만)
"""
import json
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _read(path):
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def inf_tables(design_root, domain):
    """도메인 INF들의 tables: frontmatter 합집합 (소문자) — 기대 테이블."""
    tabs = set()
    d = os.path.join(design_root, domain, "INF")
    if not os.path.isdir(d):
        return tabs
    for fn in os.listdir(d):
        if not (fn.startswith("INF-") and fn.endswith(".md")):
            continue
        m = re.match(r"^---\s*\n(.*?)\n---", _read(os.path.join(d, fn)), re.S)
        if not m:
            continue
        fb = m.group(1)
        bm = re.search(r"^tables:\s*\n(.*?)(?=^\S|\Z)", fb, re.S | re.M)
        if bm:
            for ln in bm.group(1).splitlines():
                s = ln.strip()
                if s.startswith("- "):
                    tabs.add(s[2:].strip().strip("\"'").lower())
        else:
            im = re.search(r"^tables:\s*\[(.*?)\]", fb, re.M)
            if im:
                for t in im.group(1).split(","):
                    if t.strip():
                        tabs.add(t.strip().strip("\"'").lower())
    return tabs


def existing_sch(design_root, domain):
    """{도메인}/SCH/SCH-*.md frontmatter table: 집합 (소문자) — 이미 생성됨."""
    tabs = set()
    d = os.path.join(design_root, domain, "SCH")
    if not os.path.isdir(d):
        return tabs
    for fn in os.listdir(d):
        if not (fn.startswith("SCH-") and fn.endswith(".md")):
            continue
        m = re.search(r"^table:\s*(.+)$", _read(os.path.join(d, fn)), re.M)
        if m:
            tabs.add(m.group(1).strip().strip("\"'").lower())
    return tabs


def build_todo(workspace):
    design_root = os.path.join(workspace, "docs", "05_설계서")
    plan_path = os.path.join(design_root, "_domain_plan.json")
    if not os.path.isfile(plan_path):
        print(f"[ERROR] {plan_path} 없음 — /sl-recon STEP 2 먼저 실행")
        return None
    plan = json.loads(_read(plan_path))

    todo, skipped = [], []
    for dd in plan.get("domains", []):
        name = dd["name"]
        code = dd.get("code", "")
        expected = inf_tables(design_root, name)
        existing = existing_sch(design_root, name)
        missing = sorted(expected - existing)
        if existing and not missing:
            skipped.append(name)
            print(f"  skip  {name}: SCH {len(existing)}개 — 전체 존재")
        else:
            todo.append({
                "name": name,
                "code": code,
                "existing": sorted(existing),
                "missing": missing,
            })
            print(f"  gen   {name}: 기대 {len(expected)} / 기존 {len(existing)} / 생성 {len(missing)}")
    return todo, skipped


def main():
    workspace = sys.argv[1] if len(sys.argv) > 1 else "."
    result = build_todo(workspace)
    if result is None:
        return 1
    todo, skipped = result
    out = os.path.join(workspace, "_tmp", "sch_todo.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(todo, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n스킵 {len(skipped)}도메인 / 생성 대상 {len(todo)}도메인 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
