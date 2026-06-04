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


# jwork/Spring MVC 등 레거시 MVC: 독립 페이지는 *Form 진입점뿐, 나머지(*List/*Pop/...)는
# 부모 Form 안에서 AJAX로 로드되는 조각(fragment) → 직접 goto 시 프레임워크 예외.
# 환경변수 SL_FRAGMENT_SUFFIXES / SL_ENTRY_REGEX 로 override 가능.
FRAGMENT_SUFFIXES = tuple(
    (os.environ.get('SL_FRAGMENT_SUFFIXES') or
     'List,Info,Pop,Detail,Ajax,Data,Save,One,Search,Excel,Download').split(',')
)
ENTRY_REGEX = os.environ.get('SL_ENTRY_REGEX', 'Form')  # screenId 접미사(대소문자 무시)


def _is_entry(screen_id: str, jwork_mode: bool) -> bool:
    """jwork_mode면 진입화면(*Form)만 통과, 명백한 조각 접미사는 제외. 아니면 전부 통과."""
    if not jwork_mode:
        return True
    sid = (screen_id or '')
    low = sid.lower()
    if low.endswith(ENTRY_REGEX.lower()):
        return True
    if any(low.endswith(suf.strip().lower()) for suf in FRAGMENT_SUFFIXES if suf.strip()):
        return False
    return True  # Form도 조각도 아닌 모호한 건 보존


def build_goto_plan(source_index: dict, domain_filter: str = None) -> list:
    """source_index dict → goto 캡처 플랜 리스트.
    kind="form" route 중 진입화면만 포함(jwork 조각 제외). 도메인은 assign_file_domains 재사용."""
    files = source_index.get('files', [])
    context_path = source_index.get('contextPath')
    pairs, _ = assign_file_domains(files)

    # 1차 수집: 모든 form route
    raw = []
    for f, dom in pairs:
        if domain_filter and dom != domain_filter:
            continue
        for r in f.get('routes', []):
            if r.get('kind') != 'form':
                continue
            route = r.get('path', '')
            segs = [s for s in route.rstrip('/').split('/') if s]
            screen_id = r.get('handlerMethod') or (segs[-1] if segs else 'screen')
            raw.append((dom, screen_id, route, f.get('filePath', '') or f.get('relPath', '')))

    # jwork-style 감지: screenId 중 하나라도 *Form 접미사 → 조각 필터 활성(Next.js 등은 미적용)
    jwork_mode = any((sid or '').lower().endswith(ENTRY_REGEX.lower()) for _, sid, _, _ in raw)

    plan = []
    for dom, screen_id, route, entry_file in raw:
        if not _is_entry(screen_id, jwork_mode):
            continue
        plan.append({
            'domain': dom,
            'screenId': screen_id,
            'route': route,
            'menuPath': menu_path_from_route(route, context_path),
            'entryFile': entry_file,
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
