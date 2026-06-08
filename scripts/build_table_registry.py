#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_table_registry.py — 추출대상 테이블 영속 레지스트리 (.speclinker/table_registry.json)

도메인별로 "어떤 테이블이 추출대상인가 + 어디서 발견됐나(INF/SQL/UIS) + SCH가 생성됐나"를
한 파일로 관리한다. SpecLens가 이 레지스트리로 추출대상 vs 생성/미생성을 표시한다.

발견 출처:
  inf — docs/05_설계서/{domain}/INF/*.md frontmatter `tables:`  (used_by_inf)
  sql — _tmp/sch_draft/{domain}/{table}.json (resolve_call_chain이 SQL에서 추출)
  uis — UIS → 호출 INF → INF.tables (used_by_screens)  [resolve_uis_inf 재사용]
생성여부:
  docs/05_설계서/{domain}/SCH/*.md frontmatter `table:` 매칭 → sch_id/generated

zero-LLM·멱등·carry-forward(직전 레지스트리 머지 — _tmp 휘발돼도 발견출처 보존).

Usage: python build_table_registry.py [workspace]   (기본: 현재 디렉토리)
출력:  .speclinker/table_registry.json
       { generated_at, tables:[{table, domain, sources[], used_by_inf[], used_by_screens[], sch_id, generated}] }
"""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_docsify as G  # scan_infs / scan_uis / scan_schs / resolve_uis_inf 재사용

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def build_registry(workspace: str) -> dict:
    infs = G.scan_infs(workspace)
    uis = G.scan_uis(workspace)
    schs = G.scan_schs(workspace)
    G.resolve_uis_inf(uis, infs)  # uis[i]['inf_ids'] 채움

    inf_by_id = {i["id"]: i for i in infs}

    # key = (domain, TABLE_UPPER) → 레지스트리 엔트리
    reg: dict = {}

    def ent(domain, table):
        tu = str(table).strip().upper()
        if not tu:
            return None
        key = (domain, tu)
        e = reg.get(key)
        if not e:
            e = {"table": str(table).strip(), "domain": domain, "sources": set(),
                 "used_by_inf": set(), "used_by_screens": set(),
                 "sch_id": None, "generated": False}
            reg[key] = e
        return e

    # ── INF tables ──
    for inf in infs:
        d = inf.get("domain", "")
        for t in (inf.get("tables") or []):
            e = ent(d, t)
            if e:
                e["sources"].add("inf")
                e["used_by_inf"].add(inf["id"])

    # ── SQL (sch_draft) ──
    draft_root = os.path.join(workspace, "_tmp", "sch_draft")
    if os.path.isdir(draft_root):
        for domain in os.listdir(draft_root):
            ddir = os.path.join(draft_root, domain)
            if not os.path.isdir(ddir):
                continue
            for fn in os.listdir(ddir):
                if not fn.endswith(".json"):
                    continue
                data = _load_json(os.path.join(ddir, fn)) or {}
                table = data.get("table") or fn[:-5]
                e = ent(domain, table)
                if e:
                    e["sources"].add("sql")

    # ── UIS → INF → tables ──
    for ui in uis:
        for iid in (ui.get("inf_ids") or []):
            inf = inf_by_id.get(iid)
            if not inf:
                continue
            d = inf.get("domain", "")
            for t in (inf.get("tables") or []):
                e = ent(d, t)
                if e:
                    e["sources"].add("uis")
                    e["used_by_screens"].add(ui["id"])

    # ── 생성된 SCH 매칭 (orphan SCH도 포함) ──
    for sch in schs:
        d = sch.get("domain", "")
        table = sch.get("table", "")
        e = ent(d, table)
        if e:
            e["generated"] = True
            e["sch_id"] = sch["id"]
            e["sources"].add("sch")

    # ── carry-forward: 직전 레지스트리 머지(소스 보존) ──
    mpath = os.path.join(workspace, ".speclinker", "table_registry.json")
    old = _load_json(mpath) or {}
    for ot in (old.get("tables") or []):
        d = ot.get("domain", "")
        tu = str(ot.get("table", "")).strip().upper()
        if not tu:
            continue
        key = (d, tu)
        if key in reg:
            # 소스 합집합(예: _tmp/sch_draft 사라져도 'sql' 보존)
            reg[key]["sources"] |= set(ot.get("sources") or [])
        else:
            # 더 이상 발견 안 되는 테이블도 보존하되 generated는 현재 기준 재계산됨(없으면 False 유지)
            reg[key] = {
                "table": ot.get("table", tu), "domain": d,
                "sources": set(ot.get("sources") or []),
                "used_by_inf": set(ot.get("used_by_inf") or []),
                "used_by_screens": set(ot.get("used_by_screens") or []),
                "sch_id": ot.get("sch_id"), "generated": bool(ot.get("generated")),
            }

    tables = []
    for (d, tu), e in sorted(reg.items()):
        tables.append({
            "table": e["table"], "domain": d,
            "sources": sorted(e["sources"]),
            "used_by_inf": sorted(e["used_by_inf"]),
            "used_by_screens": sorted(e["used_by_screens"]),
            "sch_id": e["sch_id"], "generated": e["generated"],
        })

    return {"generated_at": datetime.now().isoformat(timespec="seconds"), "tables": tables}


def write_registry(workspace: str) -> dict:
    reg = build_registry(workspace)
    out = os.path.join(workspace, ".speclinker", "table_registry.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
    return reg


def main():
    workspace = sys.argv[1] if len(sys.argv) > 1 else "."
    reg = write_registry(workspace)
    tables = reg["tables"]
    gen = sum(1 for t in tables if t["generated"])
    miss = len(tables) - gen
    by_dom = {}
    for t in tables:
        by_dom.setdefault(t["domain"], [0, 0])
        by_dom[t["domain"]][0] += 1
        if t["generated"]:
            by_dom[t["domain"]][1] += 1
    print(f"테이블 레지스트리: 총 {len(tables)}개 (생성 {gen} / 미생성 {miss})")
    for d, (tot, g) in sorted(by_dom.items()):
        print(f"  {d}: {g}/{tot}")
    print(f"→ .speclinker/table_registry.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
