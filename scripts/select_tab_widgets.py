# STATUS: 완료
#!/usr/bin/env python3
"""
select_tab_widgets.py — 화면/탭의 인터랙션 위젯을 **전수(결정론)** 선택 → annotate용 widgets.json

왜: 마킹 대상 '선택'을 AI 판단에 맡기면 계속 누락된다(AI가 subset을 고름). 선택은 결정론으로 한다:
  DOM 스냅샷(capture_screen_dom이 button/a/input/select 전수 추출) → 공통툴바·탭바만 기계적 제외
  → 남은 **모든 인터랙션 위젯**을 번호 매겨 출력. 에이전트는 *고르지 않고* 각각을 설명만 한다.

선택 규칙(전수):
  - tag ∈ {button, a, select} (인터랙션) 이고 (id 있음 OR onclick 있음)
  - 제외: 공통 chrome(여러 탭에 반복 등장하는 id — 개요 마커에서 1회 표시),
          탭바 링크(label이 탭명), 상단 공통툴바(y < toolbar_y)
  - bbox 중복(같은 id) 1회만

Usage:
  python select_tab_widgets.py --captures-dir <_tmp/captures/{screenId}> [--tab N] [--toolbar-y 90] --out <widgets.json>
  (--tab 생략 시 dom_snapshot.json 사용=단일/활성 화면)
"""
import os, sys, json, glob, argparse
from collections import Counter
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--captures-dir', required=True)
    ap.add_argument('--tab', type=int, default=0)
    ap.add_argument('--toolbar-y', type=int, default=90, help='이 y 미만은 상단 공통툴바로 보고 제외')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    cd = a.captures_dir
    snap_path = os.path.join(cd, f'dom_snapshot_tab{a.tab}.json') if a.tab else os.path.join(cd, 'dom_snapshot.json')
    if not os.path.exists(snap_path):
        print(f'[ERROR] 스냅샷 없음: {snap_path}'); return 1
    widgets = json.load(open(snap_path, encoding='utf-8')).get('widgets', [])

    # 공통 id(여러 탭 반복) + 탭바 라벨 — 멀티탭일 때만
    common, tabbar = set(), set()
    tab_snaps = sorted(glob.glob(os.path.join(cd, 'dom_snapshot_tab*.json')))
    if len(tab_snaps) > 1:
        cnt = Counter()
        tab_names = []
        for f in tab_snaps:
            ws = json.load(open(f, encoding='utf-8')).get('widgets', [])
            for i in set(w.get('id') for w in ws if w.get('id')):
                cnt[i] += 1
        common = {i for i, c in cnt.items() if c >= max(2, len(tab_snaps) - 2)}
        # 탭바 라벨 = 탭명(여러 탭 스냅샷에 동일 라벨의 무-id a가 반복)
        for f in tab_snaps:
            for w in json.load(open(f, encoding='utf-8')).get('widgets', []):
                if w['tag'] == 'a' and not w.get('id') and (w.get('label') or '').strip():
                    tabbar.add(w['label'].strip())

    def interactive(w):
        if w.get('tag') not in ('button', 'a', 'select'):
            return False
        if not (w.get('id') or w.get('onclick')):
            return False
        if w.get('id') in common:
            return False
        if w['bbox'][1] < a.toolbar_y:
            return False
        if (w.get('label') or '').strip() in tabbar:
            return False
        return True

    seen, out, num = set(), [], 1
    for w in sorted(widgets, key=lambda w: (w['bbox'][1], w['bbox'][0])):
        if not interactive(w):
            continue
        key = w.get('id') or (w.get('label'), w['bbox'][1])
        if key in seen:
            continue
        seen.add(key)
        out.append({'number': num, 'id': w.get('id', ''), 'name': w.get('name', ''),
                    'label': (w.get('label') or w.get('id') or '')[:24], 'bbox': w['bbox']})
        num += 1

    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'[select] 인터랙션 위젯 전수 {len(out)}개 → {a.out}  (공통제외 {len(common)}, 탭바제외 {len(tabbar)})')
    print('  → annotate_preview.py로 마커, 에이전트는 이 목록 *전부*를 설명(고르지 말 것)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
