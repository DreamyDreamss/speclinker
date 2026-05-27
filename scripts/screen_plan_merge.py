# STATUS: 완료
#!/usr/bin/env python3
"""
screen_plan_merge.py — Phase 7.4 (Screen-first RECON)
_tmp/screen_plan_static.json + _tmp/screen_plan_runtime.json 병합.

정책:
  - route 기준 dedup. 정적 발견이 우선 (entry/component_files 보유).
  - 런타임에만 있는 route → 정적 목록에 추가 (cdp_required=True).
  - 정적에는 있으나 런타임에서 미발견 → 그대로 유지 (미확인 화면).
  - 런타임 metadata(menu_l1, menu_l2) → 정적 레코드의 metadata에 병합.

Usage:
  python3 screen_plan_merge.py <workspace_dir>
    [--static  _tmp/screen_plan_static.json]
    [--runtime _tmp/screen_plan_runtime.json]
    [--out     _tmp/screen_plan_merged.json]
"""

import sys
import os
import json
import argparse
from datetime import datetime, timezone


def load(path):
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f'[merge] 로드 실패: {path} — {e}', file=sys.stderr)
        return None


def norm_route(route):
    """비교용 정규화: 쿼리 파라미터 제거, 슬래시 통일."""
    if not route:
        return ''
    return route.split('?')[0].rstrip('/').lower() or '/'


def merge(static_doc, runtime_doc):
    static_screens  = static_doc.get('screens', []) if static_doc else []
    runtime_screens = runtime_doc.get('screens', []) if runtime_doc else []

    # 정적 목록 → route → 인덱스 맵
    static_map = {}
    for i, s in enumerate(static_screens):
        static_map[norm_route(s.get('route', ''))] = i

    # 런타임 레코드 처리
    added = 0
    enriched = 0
    for r in runtime_screens:
        key = norm_route(r.get('route', ''))
        if not key:
            continue

        if key in static_map:
            # 정적 레코드 보강: menu_l1/l2, cdp_required, route_keyword
            idx = static_map[key]
            s = static_screens[idx]
            meta = s.setdefault('metadata', {})
            r_meta = r.get('metadata', {})
            for field in ('menu_l1', 'menu_l2', 'full_url'):
                if r_meta.get(field):
                    meta[field] = r_meta[field]
            # capture 보강
            cap = s.setdefault('capture', {})
            cap['cdp_required'] = True
            if not cap.get('route_keyword'):
                cap['route_keyword'] = r.get('capture', {}).get('route_keyword', '')
            enriched += 1
        else:
            # 런타임 전용 → 정적 목록에 추가
            r['source'] = 'runtime-bfs'
            static_screens.append(r)
            static_map[key] = len(static_screens) - 1
            added += 1

    return static_screens, added, enriched


def main():
    p = argparse.ArgumentParser(description='Phase 7.4 화면 목록 병합')
    p.add_argument('workspace_dir', nargs='?', default=os.getcwd())
    p.add_argument('--static',  default=None)
    p.add_argument('--runtime', default=None)
    p.add_argument('--out',     default=None)
    args = p.parse_args()

    ws = os.path.abspath(args.workspace_dir)
    tmp = os.path.join(ws, '_tmp')
    os.makedirs(tmp, exist_ok=True)

    static_path  = args.static  or os.path.join(tmp, 'screen_plan_static.json')
    runtime_path = args.runtime or os.path.join(tmp, 'screen_plan_runtime.json')
    out_path     = args.out     or os.path.join(tmp, 'screen_plan_merged.json')

    static_doc  = load(static_path)
    runtime_doc = load(runtime_path)

    if static_doc is None and runtime_doc is None:
        print('[merge] 입력 파일 없음. screen_plan_discover.py / capture.js --traverse-menu 먼저 실행.', file=sys.stderr)
        sys.exit(1)

    merged_screens, added, enriched = merge(static_doc, runtime_doc)

    # discovery 통계 재계산
    static_count  = len((static_doc or {}).get('screens', []))
    runtime_count = len((runtime_doc or {}).get('screens', []))
    static_disc   = (static_doc  or {}).get('discovery', {})
    runtime_disc  = (runtime_doc or {}).get('discovery', {})

    now = datetime.now(timezone.utc).astimezone().isoformat()
    output = {
        'version': 1,
        'generated_at': now,
        'confirmed_by': '',
        'confirmed_at': '',
        'discovery': {
            'mode_used':       'merged',
            'static_count':    static_count,
            'runtime_count':   runtime_count,
            'merged_total':    len(merged_screens),
            'runtime_added':   added,
            'runtime_enriched': enriched,
            'manual_count':    static_disc.get('manual_count', 0),
            'excluded_count':  0,
            'framework_used':  static_disc.get('framework_used', 'unknown'),
        },
        'screens': merged_screens,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'[merge] 완료: 총 {len(merged_screens)}개')
    print(f'  정적: {static_count}개  런타임: {runtime_count}개')
    print(f'  런타임 추가: {added}개  보강(메뉴정보): {enriched}개')
    print(f'[저장] {out_path}')


if __name__ == '__main__':
    main()
