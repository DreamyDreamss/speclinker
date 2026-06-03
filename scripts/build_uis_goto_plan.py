#!/usr/bin/env python3
"""
build_uis_goto_plan.py — source_index.json의 form routes → UIS goto 캡처 플랜

BFS 브라우저 탐색 대신, 소스에 이미 존재하는 kind="form" route를 직접 goto 캡처한다.
각 화면: route(URL) + screenId + menuPath(URL 계층) + domain(relPath 기반) + entryFile.

도메인은 build_domain_catalog.assign_file_domains를 재사용한다 (범용, Java+Next.js 동일).

Usage:
    python build_uis_goto_plan.py [source_index_path] [output_path] [domain_filter]
    기본값: _tmp/source_index.json → _tmp/uis_goto_plan.json
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_domain_catalog import assign_file_domains


def menu_path_from_route(url: str, context_path) -> list:
    """route URL → 메뉴 계층 리스트. contextPath 제거 후 세그먼트 분해."""
    path = url or ''
    if context_path and path.startswith(context_path):
        path = path[len(context_path):]
    return [s for s in path.strip('/').split('/') if s]


def build_goto_plan(source_index: dict, domain_filter: str = None) -> list:
    """source_index dict → goto 캡처 플랜 리스트.
    kind="form" route만 화면으로 포함. 도메인은 assign_file_domains 재사용."""
    files = source_index.get('files', [])
    context_path = source_index.get('contextPath')
    pairs, _ = assign_file_domains(files)

    plan = []
    for f, dom in pairs:
        if domain_filter and dom != domain_filter:
            continue
        for r in f.get('routes', []):
            if r.get('kind') != 'form':
                continue
            route = r.get('path', '')
            segs = [s for s in route.rstrip('/').split('/') if s]
            screen_id = r.get('handlerMethod') or (segs[-1] if segs else 'screen')
            plan.append({
                'domain': dom,
                'screenId': screen_id,
                'route': route,
                'menuPath': menu_path_from_route(route, context_path),
                'entryFile': f.get('filePath', '') or f.get('relPath', ''),
            })
    return plan


def generate_goto_plan(source_index_path: str, output_path: str, domain_filter: str = None) -> list:
    """source_index.json 읽기 → goto 플랜 생성 → 저장 → 리스트 반환."""
    with open(source_index_path, encoding='utf-8', errors='replace') as f:
        idx = json.load(f)
    plan = build_goto_plan(idx, domain_filter)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    return plan


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    src = sys.argv[1] if len(sys.argv) > 1 else '_tmp/source_index.json'
    out = sys.argv[2] if len(sys.argv) > 2 else '_tmp/uis_goto_plan.json'
    dom = sys.argv[3] if len(sys.argv) > 3 else None
    if not os.path.isfile(src):
        print(f'[ERROR] {src} 없음 — scan_source.js 먼저 실행')
        sys.exit(1)
    plan = generate_goto_plan(src, out, dom)
    from collections import Counter
    by_dom = Counter(s['domain'] for s in plan)
    flt = f' (필터: {dom})' if dom else ''
    print(f'[OK] uis_goto_plan.json — form 화면 {len(plan)}개{flt}')
    for d, c in by_dom.most_common(20):
        print(f'  {d:<20} {c}개')
    print(f'  → {out}')
