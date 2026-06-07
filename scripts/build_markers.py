# STATUS: 완료
#!/usr/bin/env python3
"""
build_markers.py — 에이전트가 고른 위젯 id 목록 → bbox 결정론 해소 → annotate용 widgets.json

마커 생성의 책임 분리(휴리스틱 금지):
  - **에이전트**: 소스를 읽어 4에 적을 *의미있는* 위젯/이벤트를 고른다(무엇을). id·번호·라벨만 준다.
  - **이 스크립트**: dom_snapshot에서 그 id의 bbox를 찾아 widgets.json을 만든다(어디에). LLM이 bbox를
    베끼다 틀리는 일·실재하지 않는 위젯 마킹을 원천 차단(스냅샷에 없는 id는 경고+skip).
  - annotate_preview.py: 그린다.

입력 markers_in.json 형식(에이전트 출력):
  [ {"number":1, "label":"조회", "id":"searchProductGrid"},
    {"number":2, "label":"저장", "id":"saveProductDetail"},
    {"number":3, "label":"MD코드", "name":"schMdId"} ]   # id 없으면 name으로 매칭

Usage:
  python build_markers.py --snapshot <dom_snapshot[_tabN].json> --markers <markers_in.json> --out <preview[_tabN]_widgets.json>
"""
import os, sys, json, argparse
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--snapshot', required=True)
    ap.add_argument('--markers', required=True, help='에이전트가 고른 [{number,label,id|name}]')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    snap = json.load(open(a.snapshot, encoding='utf-8'))
    widgets = snap.get('widgets', snap if isinstance(snap, list) else [])
    by_id = {w.get('id'): w for w in widgets if w.get('id')}
    by_name = {}
    for w in widgets:
        if w.get('name'):
            by_name.setdefault(w['name'], w)

    markers_in = json.load(open(a.markers, encoding='utf-8'))
    out, missing = [], []
    for m in markers_in:
        wid = m.get('id') or ''
        nm = m.get('name') or ''
        w = by_id.get(wid) or by_name.get(nm) or by_name.get(wid)
        if not w:
            missing.append(wid or nm or '?')
            continue
        out.append({'number': m.get('number'),
                    'label': (m.get('label') or w.get('label') or wid)[:24],
                    'bbox': w['bbox']})

    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'[markers] {len(out)}/{len(markers_in)} 해소 → {a.out}')
    if missing:
        print(f'[WARN] 스냅샷에 없는 위젯(skip): {", ".join(missing[:10])}'
              + (f' 외 {len(missing)-10}' if len(missing) > 10 else ''))
        print('  → 에이전트가 4에 실재하지 않는 위젯을 적었거나 id 오기. 소스/스냅샷 재확인.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
