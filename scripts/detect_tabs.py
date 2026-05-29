"""
detect_tabs.py — JSP 탭 구조 감지 → uis_capture_map.json 탭 서브엔트리 추가

사용법:
  python detect_tabs.py <workspace>

동작:
  1. uis_capture_map.json 읽기
  2. 각 화면의 소스 JSP 검색
  3. JSP에서 탭 패턴 감지 (<script src="*t01.js">, <div id="tab1"> 등)
  4. 탭 감지 시 서브 엔트리 생성 (screenId: {base}_tab{N})
  5. uis_capture_map.json 갱신
"""

import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass


# ── 탭 레이블 패턴 (JSP 탭 네비 파싱) ──────────────────────────────────────
_TAB_NAV_RE = re.compile(
    r'href=["\']#tab(\d+)["\'][^>]*>\s*([^<]{1,30}?)\s*</a',
    re.IGNORECASE,
)

# <script src="...pr201t01.js"> 패턴
_SCRIPT_TAB_RE = re.compile(
    r'<script[^>]+src=["\'][^"\']*?(\w+)t(\d{2})\.js[^"\']*["\']',
    re.IGNORECASE,
)

# <div ... id="tab1"> 패턴
_DIV_TAB_RE = re.compile(
    r'<div[^>]+id=["\']tab(\d+)["\']',
    re.IGNORECASE,
)


def find_jsp_file(workspace: str, screen_id: str) -> str | None:
    """screenId 기반으로 JSP 파일 경로를 탐색한다."""
    # uis_capture_map의 screenId (예: pr201Form, or415mForm 등)
    # JSP는 WEB-INF/jsp/ 하위에 screenId.jsp 또는 screenIdForm.jsp 형태
    search_roots = []
    for root, dirs, files in os.walk(workspace):
        # node_modules, .git 등 제외
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'target', '.understand-anything')]
        for f in files:
            if f.lower().endswith('.jsp') and screen_id.lower() in f.lower():
                return os.path.join(root, f)
    return None


def detect_tabs_in_jsp(jsp_path: str) -> dict:
    """JSP 파일에서 탭 구조를 감지한다.

    Returns:
        {
          "tabCount": int,
          "tabs": [{"index": 1, "label": "기초정보", "jsFile": "pr201t01.js"}, ...]
        }
        탭 없으면 {"tabCount": 0, "tabs": []}
    """
    try:
        content = open(jsp_path, encoding='utf-8', errors='replace').read()
    except Exception:
        return {"tabCount": 0, "tabs": []}

    # 탭 네비에서 레이블 수집
    nav_labels = {}
    for m in _TAB_NAV_RE.finditer(content):
        nav_labels[int(m.group(1))] = m.group(2).strip()

    # <script src> 에서 탭 JS 파일 수집
    script_tabs = {}
    for m in _SCRIPT_TAB_RE.finditer(content):
        base = m.group(1)
        idx  = int(m.group(2))
        js_file = f"{base}t{m.group(2)}.js"
        script_tabs[idx] = js_file

    # <div id="tabN"> 개수로 검증
    div_tabs = set(int(m.group(1)) for m in _DIV_TAB_RE.finditer(content))

    # 교집합: script_tabs 와 div_tabs 모두 있는 탭만 확정
    confirmed = set(script_tabs.keys()) & div_tabs
    if len(confirmed) < 2:
        return {"tabCount": 0, "tabs": []}

    tabs = []
    for idx in sorted(confirmed):
        tabs.append({
            "index":   idx,
            "label":   nav_labels.get(idx, f"tab{idx}"),
            "jsFile":  script_tabs.get(idx, ""),
        })

    return {"tabCount": len(tabs), "tabs": tabs}


def main(workspace: str):
    cap_path = os.path.join(workspace, '_tmp', 'uis_capture_map.json')
    if not os.path.exists(cap_path):
        print(f"[ERROR] {cap_path} 없음", file=sys.stderr)
        sys.exit(1)

    cap_map: list = json.load(open(cap_path, encoding='utf-8'))
    new_entries = []
    modified = 0

    for entry in cap_map:
        screen_id = entry.get('screenId', '')
        if not screen_id:
            continue

        # 이미 탭 서브엔트리가 있으면 스킵
        if entry.get('parentScreenId'):
            continue

        # 탭 감지
        jsp_path = find_jsp_file(workspace, screen_id)
        if not jsp_path:
            continue

        tab_info = detect_tabs_in_jsp(jsp_path)
        if tab_info['tabCount'] < 2:
            continue

        # 메인 엔트리에 탭 정보 기록
        entry['hasTabs']  = True
        entry['tabCount'] = tab_info['tabCount']
        entry['jspPath']  = jsp_path

        print(f"[탭감지] {screen_id} ({tab_info['tabCount']}탭) ← {os.path.basename(jsp_path)}")
        for t in tab_info['tabs']:
            print(f"  tab{t['index']} {t['label']:15s} {t['jsFile']}")

        # 서브 엔트리 생성
        for t in tab_info['tabs']:
            sub_id = f"{screen_id}_tab{t['index']}"
            # 이미 서브엔트리 있으면 스킵
            if any(e.get('screenId') == sub_id for e in cap_map):
                continue
            sub = {
                "screenId":       sub_id,
                "screenLabel":    f"{entry.get('screenLabel', screen_id)} - {t['label']}",
                "menuPath":       entry.get('menuPath', []),
                "domain":         entry.get('domain', ''),
                "activeRoute":    entry.get('activeRoute', ''),
                "tabIndex":       t['index'],
                "tabLabel":       t['label'],
                "tabJsFile":      t['jsFile'],
                "parentScreenId": screen_id,
                "jspPath":        jsp_path,
                "captureDir":     None,
                "captureFile":    None,
            }
            new_entries.append(sub)
            modified += 1

    if modified == 0:
        print("탭 감지된 화면 없음 (또는 이미 처리됨)")
        return

    cap_map.extend(new_entries)
    json.dump(cap_map, open(cap_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"\n✅ 서브 엔트리 {modified}개 추가 → {cap_path}")


if __name__ == '__main__':
    ws = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    main(ws)
