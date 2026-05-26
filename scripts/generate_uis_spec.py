"""
generate_uis_spec.py — capture.js 결과(preview_*.png + preview_*_widgets.json) 로부터
                       Phase 6.1 형식 spec.md 자동 생성.

핵심: §4 위젯 표를 widgets.json에서 자동 채움. 사람이 보완할 placeholder/default/validation은 [TBD].

사용:
  python3 generate_uis_spec.py <UI_dir> --uis-id=UIS-F-001 --screen-id=Pr201Form
                                         --screen-name=상품등록 --route=/product/prdreg/pr201Form
                                         --domain=product
"""
import os
import sys
import json
import argparse
import re
from datetime import date


def find_tab_assets(ui_dir):
    """디렉토리에서 preview_tab*_*.png + 그에 매칭되는 widgets.json 찾기.
    Returns: [{'name': str, 'png': path, 'widgets_json': path|None, 'order': int}]
    """
    pat = re.compile(r'^preview_tab(\d+)_(.+)\.png$')
    tabs = []
    for f in sorted(os.listdir(ui_dir)):
        m = pat.match(f)
        if not m:
            continue
        order = int(m.group(1))
        name = m.group(2).replace('_annotated', '')
        if name.endswith('_annotated'):
            continue
        if '_annotated' in f:
            continue
        png = os.path.join(ui_dir, f)
        widgets_json = png.replace('.png', '_widgets.json')
        annotated = png.replace('.png', '_annotated.png')
        tabs.append({
            'order': order,
            'name': name,
            'png': f,
            'annotated_png': os.path.basename(annotated) if os.path.exists(annotated) else None,
            'widgets_json': widgets_json if os.path.exists(widgets_json) else None,
        })
    tabs.sort(key=lambda t: t['order'])
    return tabs


def load_widgets(path):
    if not path or not os.path.exists(path):
        return []
    try:
        return json.load(open(path, encoding='utf-8'))
    except Exception:
        return []


def _md_escape(s):
    return (s or '').strip().replace('|', '\\|').replace('\n', ' ')


def _widget_type(w):
    """DOM meta → §4 표의 '타입' 컬럼 (button/input-text/select/textarea/...)."""
    tag  = (w.get('tag') or '').lower()
    typ  = (w.get('type') or '').lower()
    if tag == 'select':   return 'select'
    if tag == 'textarea': return 'textarea'
    if tag == 'button' or typ in ('button','submit'): return 'button'
    if tag == 'a':        return 'link/button'
    if typ:               return f'input-{typ}'
    return tag or '(auto)'


def _validation_text(w):
    """required·pattern·min/max·maxlength → '유효성' 컬럼 한 줄."""
    parts = []
    if w.get('required'):  parts.append('required')
    if w.get('readonly'):  parts.append('readonly')
    if w.get('disabled'):  parts.append('disabled')
    if w.get('pattern'):   parts.append(f"pattern=`{w['pattern']}`")
    if w.get('maxlength'): parts.append(f"max={w['maxlength']}자")
    if w.get('minlength'): parts.append(f"min={w['minlength']}자")
    if w.get('min') is not None and w.get('min') != '': parts.append(f"min={w['min']}")
    if w.get('max') is not None and w.get('max') != '': parts.append(f"max={w['max']}")
    return ', '.join(parts) if parts else '[TBD]'


def _selector_text(w):
    """위젯 식별용 selector 우선순위: dom_id > name > bbox."""
    if w.get('dom_id'): return f"`#{w['dom_id']}`"
    if w.get('name'):   return f"`[name=\"{w['name']}\"]`"
    bbox = w.get('bbox') or [0,0,0,0]
    return f'`bbox={bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}`'


def render_widget_table(widgets):
    """widgets.json → §4 위젯 표 markdown rows.
    DOM meta(placeholder/default/required 등)는 capture.js Phase 6.4 U6에서 dump.
    """
    if not widgets:
        return '| (위젯 자동 발견 없음) | - | - | - | - | - | - | - | - | - | - |'
    rows = []
    for w in widgets:
        wid   = w.get('id', '-')
        num   = w.get('number', '-')
        wtype = _widget_type(w)
        label = _md_escape(w.get('label'))
        placeholder = _md_escape(w.get('placeholder')) if w.get('placeholder') else '[TBD]'
        default_v   = _md_escape(str(w.get('default_value'))) if w.get('default_value') not in (None, '') else '[TBD]'
        # disabled_when — disabled=true 면 '초기상태 disabled', 아니면 정적분석 필요
        disabled_when = '초기 disabled' if w.get('disabled') else '[TBD]'
        validation    = _validation_text(w)
        selector_md   = _selector_text(w)
        api_hint      = '[TBD]'  # U9 — sl-recon STEP 4 INF cross-link
        source        = '(auto-discover)'
        rows.append(
            f'| {wid} | {num} | {wtype} | {label} | {placeholder} | {default_v} | {disabled_when} | {validation} | {selector_md} | {api_hint} | {source} |'
        )
    return '\n'.join(rows)


def render_state_table():
    return '''| ST-01 | 초기 | 페이지 첫 로드 | 빈 폼, 그리드 비어있음 | §2 |
| ST-02 | 로딩중 | API 요청 중 | 액션 버튼 비활성 + 로딩 오버레이 | §2 |
| ST-03 | 정상 | 응답 성공 | 데이터 표시 | §2 |
| ST-04 | 빈 결과 | API 200, 데이터 0건 | "조회된 결과가 없습니다" | §2 |
| ST-05 | 오류 | API 4xx/5xx | 에러 메시지 alert | §2 |'''


def build_spec(ui_dir, uis_id, screen_id, screen_name, route, domain):
    tabs = find_tab_assets(ui_dir)
    today = date.today().isoformat()

    parts = []
    # frontmatter
    parts.append(f'''---
화면ID: {screen_id}
화면명: {screen_name}
라우트: {route}
도메인: {domain}
REQ-F: "[TBD]"
UIS-ID: {uis_id}
revision_history:
  - version: 1.0
    date: {today}
    author: ddd-ui-agent (capture.js + generate_uis_spec.py)
    change: 최초 자동 생성 (capture.js auto-annotate {len(tabs)}탭 기반)
---

# {uis_id}: {screen_name}

> **UIS-ID:** {uis_id} | **API:** [TBD] | **DB:** [TBD]

**근거 소스:**
- 실서비스 캡처 — `office-t.kshop.co.kr{route}`
- 탭 {len(tabs)}개 자동 발견·캡처

''')

    # §0 화면 미리보기
    parts.append('## §0 화면 미리보기')
    parts.append('')
    if not tabs:
        parts.append('![[preview.png]]')
    else:
        for t in tabs:
            parts.append(f'### §0.{t["order"]} {t["name"]}')
            parts.append('')
            parts.append(f'**원본**: ![[{t["png"]}]]')
            parts.append('')
            if t['annotated_png']:
                parts.append(f'**디스크립션 마커**: ![[{t["annotated_png"]}]]')
                parts.append('')
            parts.append('')
    parts.append('')

    # §1 화면 기본 정보
    parts.append('''## §1 화면 기본 정보

| 항목 | 내용 |
|------|------|
| 화면 ID | ''' + screen_id + ''' |
| 화면명 | ''' + screen_name + ''' |
| 라우트 | `''' + route + '''` |
| 도메인 | ''' + domain + ''' |
| 화면 유형 | 주화면 (Master + Detail 다탭) |
| 접근 권한 | [TBD — 소스 분석 필요] |
| 진입 조건 | [TBD] |

''')

    # §2 와이어프레임 + 디스크립션 마커 — annotated 이미지 자체로 대체
    parts.append('''## §2 와이어프레임 + 디스크립션 마커

> 각 탭의 `_annotated.png`가 곧 §2 와이어프레임 역할.
> 마커 번호 `N` = §4 위젯 표의 `번호` 컬럼과 1:1 매칭.
> ASCII 와이어프레임은 생략 (실제 캡처가 더 정확).

''')

    # §3 블록 정의 — auto는 어려움, placeholder
    parts.append('''## §3 블록 정의

| 블록 ID | 번호 | 설명 | 소스 컴포넌트 |
|--------|------|------|------------|
| BL-01 | - | 상단 헤더 (탭·검색조건) | [TBD] |
| BL-02 | - | 좌측 목록 그리드 | [TBD] |
| BL-03 | - | 우측 상세 폼 (탭 본문) | [TBD] |
| BL-04 | - | 하단 액션 영역 | [TBD] |

''')

    # §4 위젯 정의 — 탭별 sub-table
    parts.append('## §4 위젯 정의')
    parts.append('')
    parts.append('> auto-annotate가 자동 발견한 button·input·select·a. `[TBD]` 항목은 사람이 보완.')
    parts.append('')
    for t in tabs:
        widgets = load_widgets(t['widgets_json'])
        parts.append(f'### §4.{t["order"]} {t["name"]} 탭 ({len(widgets)}개)')
        parts.append('')
        parts.append('| 위젯 ID | 번호 | 타입 | 레이블 | placeholder | default | disabled_when | 유효성 | selector | 연결 API | 소스 |')
        parts.append('|--------|------|------|-------|-------------|---------|---------------|--------|----------|---------|------|')
        parts.append(render_widget_table(widgets))
        parts.append('')

    # §5 인터랙션 이벤트 매핑
    parts.append('''## §5 인터랙션 이벤트 매핑

> 이벤트별 API 호출·에러 매핑은 INF 추출(sl-recon STEP 4) 후 자동 합성.
> 현재는 placeholder.

| 이벤트 | 트리거 위젯 | 전이 상태 | API 호출 | 성공 시 UI | HTTP 코드 | 도메인 에러 | 화면 메시지 | 후속 행동 |
|--------|-----------|---------|---------|----------|---------|----------|----------|---------|
| 페이지 진입 | route mount | ST-01 | [TBD INF-NNN] | ST-03 | - | - | - | - |
| 조회 클릭 | [TBD 위젯번호] | ST-02 | [TBD INF-NNN] | ST-03 | 4xx | [TBD] | [TBD] | [TBD] |
| 저장 클릭 | [TBD 위젯번호] | ST-02 | [TBD INF-NNN] | ST-06 | 4xx | [TBD] | [TBD] | [TBD] |

''')

    # §6 화면 상태 정의
    parts.append('''## §6 화면 상태 정의

| 상태 ID | 상태명 | 진입 조건 | UI 표현 | 와이어프레임 |
|--------|--------|---------|--------|-----------|
''' + render_state_table() + '''

''')

    # §7 화면 전환
    parts.append('''## §7 화면 전환

```mermaid
flowchart LR
  THIS[''' + uis_id + ''' ''' + screen_name + ''']
  THIS -->|[TBD]| NEXT1[UIS-F-XXX 다음화면]
```

| 이벤트 / 조건 | 이동 대상 | 대상 UIS-ID | 전달값 |
|-------------|----------|-----------|--------|
| [TBD] | [TBD] | UIS-F-XXX | - |

''')

    # §8 조건부 렌더링
    parts.append('''## §8 조건부 렌더링 (권한·상태)

| 조건 | 표시 요소 | 숨김/비활성 요소 | 비고 |
|------|---------|---------------|------|
| [TBD] | [TBD] | [TBD] | [TBD] |

''')

    # §9 미확인
    parts.append(f'''## §9 미확인 사항

- 위젯 표의 `placeholder`/`default`/`disabled_when`/`유효성`/`연결 API` — 소스 분석 또는 사람 보완 필요
- §5 인터랙션 이벤트의 실제 API 호출 매핑 — sl-recon STEP 4 (INF 추출) 후 자동 채워짐
- §3 블록 정의의 실제 영역 분할 — 사람 검수
- §7 화면 전환의 실제 다음 화면 — RTM 매핑 후
- §8 조건부 렌더링 — 소스의 `v-if`/`hasPermission` 등 분석 후 (auto-discover 가능)

---

> 자동 생성 도구:
> - 캡처: `capture.js --tabs=auto --auto-annotate` ({len(tabs)}탭)
> - spec.md: `generate_uis_spec.py`
''')

    return '\n'.join(parts)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('ui_dir')
    p.add_argument('--uis-id', required=True)
    p.add_argument('--screen-id', required=True)
    p.add_argument('--screen-name', required=True)
    p.add_argument('--route', required=True)
    p.add_argument('--domain', required=True)
    p.add_argument('--out', default='spec.md')
    args = p.parse_args()

    ui_dir = os.path.abspath(args.ui_dir)
    spec_md = build_spec(ui_dir, args.uis_id, args.screen_id, args.screen_name, args.route, args.domain)

    out_path = args.out if os.path.isabs(args.out) else os.path.join(ui_dir, args.out)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(spec_md)
    print(f'spec.md 생성: {out_path} ({len(spec_md)} chars)')


if __name__ == '__main__':
    main()
