"""
build_capture_plan.py — runtime_capture.js가 사용할 화면별 캡처 시나리오 생성

screen_inventory.json 의 각 화면을 분류:
  - standalone: URL 직접 접근 가능 (대부분의 메뉴 메인 페이지)
  - dynamic-route: /orders/:id 같은 경로 파라미터 포함 → 목록 진입 + 첫 행 클릭
  - search-result: 쿼리스트링 필요 → 미지원 (사용자 수동 편집)
  - modal-only: 라우트 없음 → 미지원

생성:
  _tmp/capture_plan.json

스키마:
  {
    "version": "1.0",
    "byUisId": {
      "UIS-F-001": {
        "route":      "/dashboard",
        "type":       "standalone",
        "preActions": [{ "action": "goto", "url": "/dashboard" }]
      },
      "UIS-F-008": {
        "route":      "/orders/:id",
        "type":       "dynamic-route",
        "fallback":   "/orders/SEED_ID",
        "preActions": [
          { "action": "goto",  "url": "/orders" },
          { "action": "wait",  "selector": "a[href^='/orders/']:not([href='/orders'])" },
          { "action": "click", "selector": "a[href^='/orders/']:not([href='/orders'])" },
          { "action": "wait",  "ms": 1500 }
        ]
      }
    }
  }

사용:
  python3 build_capture_plan.py [workspace]

특이사항:
  - 이미 capture_plan.json 이 존재하면 사용자가 손댄 항목은 보존 (manualOverride 플래그)
  - 동적 라우트 패턴: /:param, /[param], /{param}, /(param) 모두 지원
"""
import json
import os
import re
import sys
from datetime import datetime


WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
INV_PATH = os.path.join(WS, '_tmp', 'screen_inventory.json')
OUT_PATH = os.path.join(WS, '_tmp', 'capture_plan.json')

# 동적 파라미터 패턴: :id, [id], {id}, (id)
DYNAMIC_PARAM = re.compile(r'(?:/:([\w_-]+)|/\[([\w_.-]+)\]|/\{([\w_-]+)\}|/\(([\w_-]+)\))')

# 명백히 search-result 인 패턴
SEARCH_PATTERN = re.compile(r'\?[\w=&]+|/search$|/search/', re.I)


def classify_route(route):
    """라우트를 분류해서 type 반환"""
    if not route or route in ('/', ''):
        return 'standalone'
    if SEARCH_PATTERN.search(route):
        return 'search-result'
    if DYNAMIC_PARAM.search(route):
        return 'dynamic-route'
    return 'standalone'


def list_parent_route(route):
    """동적 라우트의 부모 (목록) 경로 추정"""
    # /orders/:id    → /orders
    # /orders/:id/edit → /orders
    # /admin/users/[id] → /admin/users
    m = DYNAMIC_PARAM.search(route)
    if not m:
        return route
    return route[:m.start()]


def make_actions_standalone(route):
    return [
        {'action': 'goto', 'url': route, 'waitUntil': 'networkidle'}
    ]


def make_actions_dynamic(route):
    parent = list_parent_route(route)
    if not parent or parent == '/':
        parent = '/'
    # 첫 행 링크 selector — 부모 경로 prefix 가진 링크 중 부모 자체 아닌 것
    link_selector = f"a[href^='{parent}/']" if parent != '/' else "main a[href]:not([href='/'])"
    return [
        {'action': 'goto',  'url': parent, 'waitUntil': 'networkidle'},
        {'action': 'wait',  'selector': link_selector, 'timeoutMs': 5000},
        {'action': 'click', 'selector': f'{link_selector}:first-of-type'},
        {'action': 'wait',  'ms': 1500},
    ]


# ────────────────────────────────────────────────────────────
# Phase 6.2 (2026-05-26): spec.md 의 §4 위젯 표 파싱 → widgets 필드
# ────────────────────────────────────────────────────────────

def _strip_inline_code(s: str) -> str:
    """`x` 또는 ``x`` 같은 markdown inline code 제거. 빈 셀(-) 도 빈 문자열로."""
    s = (s or '').strip()
    if s in ('-', '—', '–', ''):
        return ''
    # backtick 제거
    s = re.sub(r'^`+|`+$', '', s)
    return s.strip()


def _parse_widget_table(md_body: str) -> list:
    """spec.md 본문에서 §4 위젯 정의 표를 파싱해 widgets 리스트 반환.

    Phase 6.1 형식:
    | 위젯 ID | 번호 | 타입 | 레이블 | placeholder | default | disabled_when | 유효성 | selector | 연결 API | 소스 |
    """
    # §4 ~ §5 사이 추출
    m = re.search(r'###?\s*§4[^\n]*\n(.+?)(?=\n###?\s*§5|\Z)', md_body, re.S)
    if not m:
        return []
    block = m.group(1)

    # 헤더 줄 찾기 (위젯 ID 포함)
    lines = [ln for ln in block.split('\n') if ln.strip().startswith('|')]
    if len(lines) < 3:
        return []
    header = [c.strip() for c in lines[0].strip().strip('|').split('|')]
    # column index 매핑 (찾을 수 있는 만큼)
    idx = {}
    for i, h in enumerate(header):
        h_norm = h.lower().replace(' ', '')
        if '위젯id' in h_norm or h_norm == 'id':
            idx['id'] = i
        elif h_norm in ('번호', 'no'):
            idx['number'] = i
        elif '레이블' in h_norm or '컬럼명' in h_norm or h_norm == 'label':
            idx['label'] = i
        elif h_norm == 'selector':
            idx['selector'] = i

    # selector 컬럼 못 찾으면 추출 불가
    if 'selector' not in idx:
        return []

    widgets = []
    # 데이터 행 (구분자 줄 제외)
    for ln in lines[2:]:
        cells = [c.strip() for c in ln.strip().strip('|').split('|')]
        if len(cells) <= idx['selector']:
            continue
        wid = _strip_inline_code(cells[idx['id']]) if 'id' in idx else ''
        sel = _strip_inline_code(cells[idx['selector']])
        if not sel:
            continue
        widget = {
            'id':       wid,
            'number':   _strip_inline_code(cells[idx['number']]) if 'number' in idx else '',
            'label':    _strip_inline_code(cells[idx['label']]) if 'label' in idx else '',
            'selector': sel,
        }
        widgets.append(widget)
    return widgets


def load_widgets_for_screen(ws: str, domain: str, screen_id: str) -> list:
    """docs/05_설계서/{도메인}/UI/{화면ID}/spec.md 가 있으면 §4 파싱해 위젯 반환."""
    if not (domain and screen_id):
        return []
    spec_path = os.path.join(ws, 'docs', '05_설계서', domain, 'UI', screen_id, 'spec.md')
    if not os.path.exists(spec_path):
        return []
    try:
        body = open(spec_path, encoding='utf-8').read()
    except Exception:
        return []
    return _parse_widget_table(body)


def main():
    if not os.path.exists(INV_PATH):
        print(f'[ERROR] {INV_PATH} 없음 — sl-recon STEP 5 먼저 실행 필요', file=sys.stderr)
        sys.exit(1)

    inventory = json.load(open(INV_PATH, encoding='utf-8'))

    # 기존 capture_plan 보존 (manualOverride 항목)
    existing = {}
    if os.path.exists(OUT_PATH):
        try:
            existing = json.load(open(OUT_PATH, encoding='utf-8')).get('byUisId', {})
        except Exception:
            existing = {}

    plan = {}
    counts = {'standalone': 0, 'dynamic-route': 0, 'search-result': 0, 'modal-only': 0, 'manual': 0}

    for item in inventory:
        uis_id = item.get('uisId') or str(item.get('id', ''))
        if not uis_id:
            continue
        if not str(uis_id).startswith('UIS-F-'):
            # uisId가 정수면 UIS-F-NNN으로 정규화
            try:
                n = int(uis_id)
                uis_id = f'UIS-F-{n:03d}'
            except Exception:
                pass

        route = item.get('route') or ''

        # 기존 사용자 수정 보존
        if uis_id in existing and existing[uis_id].get('manualOverride'):
            plan[uis_id] = existing[uis_id]
            counts['manual'] += 1
            continue

        rtype = classify_route(route)
        entry = {
            'route':    route,
            'type':     rtype,
            'domain':   item.get('domain'),
            'screen':   item.get('screen') or item.get('entryFile'),
        }

        if rtype == 'standalone':
            entry['preActions'] = make_actions_standalone(route)
        elif rtype == 'dynamic-route':
            entry['preActions'] = make_actions_dynamic(route)
            entry['fallback'] = route  # 사용자가 seed ID 직접 채워 넣을 위치
            entry['hint'] = '동적 ID는 목록 첫 행 자동 클릭으로 추출. 실패 시 fallback URL을 실제 ID로 교체'
        elif rtype == 'search-result':
            entry['preActions'] = []
            entry['hint'] = '검색 결과 화면 — 사용자가 직접 preActions 정의 필요. manualOverride: true 추가 후 편집'
        else:
            entry['preActions'] = []
            entry['hint'] = '자동 분류 불가 — 수동 편집 권장'

        # Phase 6.2 (2026-05-26): spec.md 가 있으면 §4 위젯 표 자동 파싱해 widgets 주입
        # runtime_capture.js 가 캡처 시점에 selector 별 boundingBox 측정 → preview_widgets.json
        screen_id = item.get('screenId') or item.get('screen') or ''
        if not screen_id and item.get('entryFile'):
            entry_base = os.path.splitext(os.path.basename(item['entryFile']))[0]
            screen_id = entry_base[:1].upper() + entry_base[1:] if entry_base else ''
        widgets = load_widgets_for_screen(WS, entry.get('domain') or '', screen_id)
        if widgets:
            entry['widgets'] = widgets

        counts[rtype] = counts.get(rtype, 0) + 1
        plan[uis_id] = entry

    out = {
        'version':     '1.0',
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'byUisId':     plan,
        'summary':     counts,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f'== capture_plan 생성 ({datetime.now().isoformat(timespec="seconds")}) ==')
    print(f'총 {len(plan)}개 화면')
    for k, v in counts.items():
        if v > 0:
            print(f'  {k:<15} {v}건')
    print(f'\n저장: {OUT_PATH}')

    if counts.get('dynamic-route', 0) > 0:
        print('\n[힌트] 동적 라우트 화면은 목록 첫 행을 자동 클릭합니다.')
        print('       특정 ID로 캡처하려면 capture_plan.json의 fallback URL을 직접 수정하세요.')
    if counts.get('search-result', 0) > 0:
        print('\n[힌트] search-result 화면은 자동 캡처 불가 — 수동 편집 필요.')


if __name__ == '__main__':
    main()
