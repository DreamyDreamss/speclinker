# STATUS: 완료
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
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass


def load_inf_index(workspace_root, domain):
    """docs/05_설계서/{domain}/INF/INF-*.md 스캔 → {(METHOD, path): INF-ID} 인덱스.
    Phase 6.4 U9 — widget api_hints 매칭용. workspace_root는 절대경로.
    """
    inf_dir = os.path.join(workspace_root, 'docs', '05_설계서', domain, 'INF')
    idx = {}  # (method_upper, path_lower) -> inf_id
    if not os.path.isdir(inf_dir):
        return idx
    for fname in os.listdir(inf_dir):
        if not (fname.startswith('INF-') and fname.endswith('.md')):
            continue
        try:
            body = open(os.path.join(inf_dir, fname), encoding='utf-8').read()
        except Exception:
            continue
        m_id  = re.search(r'^inf-id:\s*(\S+)', body, re.M | re.I)
        m_mtd = re.search(r'^method:\s*(\S+)',  body, re.M | re.I)
        m_pth = re.search(r'^path:\s*(\S+)',    body, re.M | re.I)
        if m_id and m_pth:
            inf_id = m_id.group(1)
            mtd    = (m_mtd.group(1) if m_mtd else '*').upper()
            pth    = m_pth.group(1).lower()
            idx[(mtd, pth)] = inf_id
            idx[('*',  pth)] = inf_id  # method-agnostic fallback
    return idx


def match_inf(api_hints, inf_idx, form_method=None):
    """widget의 api_hints 중 INF 매칭되는 첫 ID. 부분 일치 허용 (path startswith)."""
    if not api_hints or not inf_idx:
        return None
    for hint in api_hints:
        h = hint.lower()
        # 1) 정확 매칭
        for (mtd, pth), inf in inf_idx.items():
            if pth == h and (mtd in ('*', (form_method or '*').upper()) or form_method is None):
                return inf
        # 2) prefix/startswith 매칭
        for (mtd, pth), inf in inf_idx.items():
            if (h.startswith(pth) or pth.startswith(h)) and len(pth) > 4:
                return inf
    return None


def find_tab_assets(ui_dir):
    """디렉토리에서 preview_tab*_*.png + 그에 매칭되는 widgets.json 찾기.
    원본(preview_tab1_foo.png)이 삭제된 경우 annotated(_annotated.png)로 fallback.
    Returns: [{'name': str, 'png': path, 'widgets_json': path|None, 'order': int}]
    """
    pat = re.compile(r'^preview_tab(\d+)_(.+)\.png$')
    by_order = {}  # order -> dict (originals take priority)
    for f in sorted(os.listdir(ui_dir)):
        m = pat.match(f)
        if not m:
            continue
        order = int(m.group(1))
        raw_name = m.group(2)
        is_annotated = raw_name.endswith('_annotated') or '_annotated' in f
        name = raw_name[:-len('_annotated')] if raw_name.endswith('_annotated') else raw_name

        if not is_annotated:
            # Original: always use, overrides any earlier annotated-only fallback
            png = os.path.join(ui_dir, f)
            widgets_json = png.replace('.png', '_widgets.json')
            annotated = png.replace('.png', '_annotated.png')
            by_order[order] = {
                'order': order, 'name': name, 'png': f,
                'annotated_png': os.path.basename(annotated) if os.path.exists(annotated) else None,
                'widgets_json': widgets_json if os.path.exists(widgets_json) else None,
            }
        elif order not in by_order:
            # Annotated-only fallback (original was deleted by annotate_preview.py)
            widgets_json = os.path.join(ui_dir, f'preview_tab{order}_{name}_widgets.json')
            by_order[order] = {
                'order': order, 'name': name, 'png': f,
                'annotated_png': f,
                'widgets_json': widgets_json if os.path.exists(widgets_json) else None,
            }

    return sorted(by_order.values(), key=lambda t: t['order'])


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
    """type_hint(capture.js 복합 감지) 우선, 없으면 DOM meta fallback."""
    hint = (w.get('type_hint') or '').lower()
    if hint == 'date-range':  return '날짜범위'
    if hint == 'code-lookup': return '코드검색'
    if hint == 'file-upload': return '파일첨부'
    if hint == 'button':      return 'button'
    if hint == 'radio':       return 'radio'
    if hint == 'checkbox':    return 'checkbox'
    if hint == 'select':      return 'select'
    if hint == 'textarea':    return 'textarea'
    if hint == 'text':        return 'input-text'
    # legacy fallback (type_hint 없는 구버전 widgets.json)
    tag = (w.get('tag') or '').lower()
    typ = (w.get('type') or '').lower()
    if tag == 'select':   return 'select'
    if tag == 'textarea': return 'textarea'
    if tag == 'button' or typ in ('button', 'submit'): return 'button'
    if tag == 'a':        return 'link/button'
    if typ == 'checkbox': return 'checkbox'
    if typ == 'radio':    return 'radio'
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


def _disabled_when_text(w):
    """U8 — disabled state + condition_hints 통합."""
    parts = []
    if w.get('disabled'): parts.append('초기 disabled')
    for c in (w.get('condition_hints') or []):
        parts.append(c)
    return ', '.join(parts) if parts else '[TBD]'


def _api_link(w, inf_idx, gaps_out=None, tab_name=''):
    """U9 — widget.api_hints → INF-NNN 매칭. 없으면 hint만 표시. 없으면 [TBD].
    gaps_out이 주어지면 미매칭 api_hints를 INF gap으로 수집한다."""
    hints  = w.get('api_hints') or []
    method = w.get('form_method')
    inf = match_inf(hints, inf_idx, method)
    if inf:
        return f'[{inf}](../../INF/{inf}.md)'
    if hints:
        if gaps_out is not None:
            gaps_out.append({
                'widget_id':    w.get('id', '-'),
                'widget_label': (w.get('label') or '').strip(),
                'url':          hints[0],
                'method':       method or 'GET',
                'api_hints':    hints,
                'tab_name':     tab_name,
            })
        return _md_escape(', '.join(f'`{h}`' for h in hints[:2])) + ' [매칭 INF 없음]'
    if w.get('handler_calls'):
        return _md_escape('fn:' + ', '.join(f'`{f}`' for f in w['handler_calls'][:2]))
    return '[TBD]'


def render_widget_table(widgets, inf_idx=None, gaps_out=None, tab_name=''):
    """widgets.json → §4 위젯 표 markdown rows.
    DOM meta(U6/U7) + condition_hints(U11) + api_hints(U9) 자동 채움.
    gaps_out 리스트가 주어지면 미매칭 api_hints를 수집한다.
    """
    inf_idx = inf_idx or {}
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
        disabled_when = _disabled_when_text(w)
        validation    = _validation_text(w)
        selector_md   = _selector_text(w)
        api_link      = _api_link(w, inf_idx, gaps_out=gaps_out, tab_name=tab_name)
        source        = '(auto-discover)'
        rows.append(
            f'| {wid} | {num} | {wtype} | {label} | {placeholder} | {default_v} | {disabled_when} | {validation} | {selector_md} | {api_link} | {source} |'
        )
    return '\n'.join(rows)


def render_interactions(tabs_with_widgets, inf_idx, gaps_out=None):
    """U10 — §5 인터랙션 표 자동 생성.
    button/submit + api_hints 가진 widget 만 row 추출 (action 분명한 것만).
    gaps_out 리스트가 주어지면 §5에서 발견된 미매칭 api_hints도 수집한다.
    """
    rows = []
    seen_gap_urls = set()  # §4에서 이미 수집된 URL 중복 방지
    for tab in tabs_with_widgets:
        for w in tab['widgets']:
            wtype = _widget_type(w)
            if wtype not in ('button', 'link/button') and (w.get('type') or '').lower() not in ('button', 'submit'):
                continue
            hints = w.get('api_hints') or []
            calls = w.get('handler_calls') or []
            if not (hints or calls):
                continue
            label = _md_escape(w.get('label')) or '(이름없음)'
            num   = w.get('number') or '-'
            inf   = match_inf(hints, inf_idx, w.get('form_method'))
            if not inf and hints and gaps_out is not None:
                url = hints[0]
                if url not in seen_gap_urls:
                    seen_gap_urls.add(url)
                    gaps_out.append({
                        'widget_id':    w.get('id', '-'),
                        'widget_label': (w.get('label') or '').strip(),
                        'url':          url,
                        'method':       w.get('form_method') or 'GET',
                        'api_hints':    hints,
                        'tab_name':     tab.get('name', ''),
                    })
            inf_md = f'[{inf}](../../INF/{inf}.md)' if inf else (
                _md_escape('`' + hints[0] + '`') if hints else _md_escape('fn:' + calls[0]) if calls else '[TBD]'
            )
            method = w.get('form_method', '[TBD]')
            event_name = '클릭'
            rows.append(
                f'| {event_name} ({label}) | [{tab["name"]}] WG-{num} | ST-02 | {inf_md} | ST-03 | {method} 200 | [TBD] | [TBD] | [TBD] |'
            )
    if not rows:
        rows.append('| 페이지 진입 | route mount | ST-01 | [TBD] | ST-03 | - | - | - | - |')
    return '\n'.join(rows)


def render_conditions(tabs_with_widgets):
    """U11 — §8 조건부 렌더링 표. capture.js가 dump한 condition_hints/disabled 신호."""
    rows = []
    for tab in tabs_with_widgets:
        for w in tab['widgets']:
            cond = w.get('condition_hints') or []
            if not cond and not w.get('disabled'):
                continue
            num = w.get('number') or '-'
            label = _md_escape(w.get('label')) or '-'
            cond_text = '초기 disabled' if w.get('disabled') and not cond else _md_escape(', '.join(cond))
            rows.append(f'| {cond_text} | [{tab["name"]}] WG-{num} {label} | - | DOM 정적 신호 (auto) |')
    if not rows:
        rows.append('| [TBD — 정적 분석 신호 없음] | [TBD] | [TBD] | 사람 보완 필요 |')
    return '\n'.join(rows)


def render_state_table():
    return '''| ST-01 | 초기 | 페이지 첫 로드 | 빈 폼, 그리드 비어있음 | §2 |
| ST-02 | 로딩중 | API 요청 중 | 액션 버튼 비활성 + 로딩 오버레이 | §2 |
| ST-03 | 정상 | 응답 성공 | 데이터 표시 | §2 |
| ST-04 | 빈 결과 | API 200, 데이터 0건 | "조회된 결과가 없습니다" | §2 |
| ST-05 | 오류 | API 4xx/5xx | 에러 메시지 alert | §2 |'''


def _find_workspace_root(ui_dir):
    """ui_dir에서 위로 탐색하여 docs/ 의 부모(= workspace root)를 찾는다."""
    cur = os.path.abspath(ui_dir)
    for _ in range(10):
        if os.path.basename(cur) == 'docs':
            return os.path.dirname(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return os.path.abspath(os.path.join(ui_dir, '..', '..', '..', '..', '..'))


def _load_project_env(workspace_root):
    """project.env → dict. 실패 시 빈 dict."""
    p = os.path.join(workspace_root, 'project.env')
    out = {}
    if not os.path.exists(p):
        return out
    try:
        for ln in open(p, encoding='utf-8').readlines():
            t = ln.strip()
            if not t or t.startswith('#') or '=' not in t:
                continue
            k, _, v = t.partition('=')
            out[k.strip()] = v.strip()
    except Exception:
        pass
    return out


def build_spec(ui_dir, uis_id, screen_id, screen_name, route, domain, workspace_root=None):
    tabs = find_tab_assets(ui_dir)
    today = date.today().isoformat()
    if workspace_root is None:
        workspace_root = _find_workspace_root(ui_dir)
    inf_idx = load_inf_index(workspace_root, domain)
    gaps = []  # INF 미매칭 api_hints 수집

    # 탭 없음 + widgets.json 존재 → capture.js 단탭 화면 또는 수동 widgets.json
    # find_tab_assets가 못 잡는 경우를 보완
    if not tabs:
        fallback_json = os.path.join(ui_dir, 'widgets.json')
        if os.path.exists(fallback_json):
            tabs = [{
                'order': 1,
                'name': screen_name or screen_id,
                'png': 'preview.png',
                'annotated_png': None,
                'widgets_json': fallback_json,
            }]

    # project.env에서 BASE_URL 로드 (출처 표기용)
    env = _load_project_env(workspace_root)
    base_url = (env.get('PREVIEW_BASE_URL') or '').rstrip('/')

    # 모든 탭의 위젯 통합 (§5·§8용)
    tabs_with_widgets = []
    for t in tabs:
        tabs_with_widgets.append({
            'name': t['name'],
            'order': t['order'],
            'widgets': load_widgets(t['widgets_json']),
            'annotated_png': t.get('annotated_png'),
        })

    # 레거시 per-tab 번호 보정: 탭이 2개 이상이고 번호가 겹치면 전역 재번호
    all_nums = []
    for tw in tabs_with_widgets:
        for w in tw['widgets']:
            n = w.get('number')
            if n is not None:
                all_nums.append(str(n))
    if len(all_nums) != len(set(all_nums)):
        global_seq = 0
        for tw in tabs_with_widgets:
            for w in tw['widgets']:
                global_seq += 1
                w['number'] = str(global_seq)
                w['id'] = 'WG-' + str(global_seq).zfill(2)

    # api_hints 수집 — frontmatter 기록 + scaffold 판단
    _all_api_hints = []
    _seen_h = set()
    for _tw in tabs_with_widgets:
        for _w in _tw['widgets']:
            for _h in (_w.get('api_hints') or []):
                if _h not in _seen_h:
                    _seen_h.add(_h)
                    _all_api_hints.append(_h)
    _api_hints_yaml = ''
    if _all_api_hints:
        _api_hints_yaml = '\napi_hints:\n' + '\n'.join(f'  - {_h}' for _h in _all_api_hints)


    parts = []
    # frontmatter
    parts.append(f'''---
화면ID: {screen_id}
화면명: {screen_name}
라우트: {route}
도메인: {domain}
req-f: "[TBD]"
UIS-ID: {uis_id}{_api_hints_yaml}
revision_history:
  - version: 1.0
    date: {today}
    author: ddd-ui-agent (capture.js + generate_uis_spec.py)
    change: 최초 자동 생성 (capture.js auto-annotate {len(tabs)}탭 기반)
---

# {uis_id}: {screen_name}

> **UIS-ID:** {uis_id} | **API:** [TBD] | **DB:** [TBD]

**근거 소스:**
- 실서비스 캡처 — `{base_url or '[PREVIEW_BASE_URL]'}{route}`
- 탭 {len(tabs)}개 자동 발견·캡처

''')

    # §0 화면 미리보기 — annotated 썸네일만 (원본 제외)
    parts.append('## §0 화면 미리보기')
    parts.append('')
    parts.append('> 아래 이미지의 원 안 번호는 §4 위젯 표의 번호와 1:1 대응. 탭별 상세는 §4에서 확인.')
    parts.append('')
    if not tabs:
        parts.append('![[preview.png]]')
    else:
        for t in tabs:
            annotated = t.get('annotated_png')
            img = annotated if annotated else t['png']
            parts.append(f'**[{t["order"]}] {t["name"]}** — ![[{img}]]')
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
    for tw in tabs_with_widgets:
        widgets = tw['widgets']
        nums = [w.get('number') for w in widgets if w.get('number')]
        int_nums = sorted(int(n) for n in nums if str(n).isdigit())
        num_range = (f'WG-{int_nums[0]}~{int_nums[-1]}' if int_nums else f'WG-{min(nums)}~{max(nums)}') if nums else '위젯 없음'
        parts.append(f'### §4.{tw["order"]} {tw["name"]} 탭 ({len(widgets)}개, {num_range})')
        parts.append('')
        if tw.get('annotated_png'):
            parts.append(f'![[{tw["annotated_png"]}]]')
            parts.append('')
        parts.append('| 위젯 ID | 번호 | 타입 | 레이블 | placeholder | default | disabled_when | 유효성 | selector | 연결 API | 소스 |')
        parts.append('|--------|------|------|-------|-------------|---------|---------------|--------|----------|---------|------|')
        parts.append(render_widget_table(widgets, inf_idx, gaps_out=gaps, tab_name=tw['name']))
        parts.append('')

    # §5 인터랙션 이벤트 매핑 (U10 자동 채움)
    parts.append('## §5 인터랙션 이벤트 매핑')
    parts.append('')
    parts.append('> capture.js가 dump한 `api_hints`/`handler_calls` + INF-{도메인} 디렉토리 매칭으로 자동 채움.')
    parts.append('> 매칭 안 된 항목은 path만 표시 + `[매칭 INF 없음]`.')
    parts.append('')
    parts.append('| 이벤트 | 트리거 위젯 | 전이 상태 | API 호출 | 성공 시 UI | HTTP 코드 | 도메인 에러 | 화면 메시지 | 후속 행동 |')
    parts.append('|--------|-----------|---------|---------|----------|---------|----------|----------|---------|')
    parts.append(render_interactions(tabs_with_widgets, inf_idx, gaps_out=gaps))
    parts.append('')
    parts.append('')

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

    # §8 조건부 렌더링 (U11 자동 채움)
    parts.append('## §8 조건부 렌더링 (권한·상태)')
    parts.append('')
    parts.append('> capture.js가 dump한 DOM 신호(disabled / hidden / aria-hidden / v-if / data-role 등)만 표시.')
    parts.append('> 정적 분석 한계 — 변수 기반 조건은 [TBD]로 두고 사람·LLM 보완 필요.')
    parts.append('')
    parts.append('| 조건/신호 | 영향 위젯 | 숨김/비활성 | 비고 |')
    parts.append('|----------|----------|------------|------|')
    parts.append(render_conditions(tabs_with_widgets))
    parts.append('')
    parts.append('')

    # §9 미확인 (Phase 6.4 갱신 — 자동 처리된 항목 제거)
    parts.append(f'''## §9 미확인 사항

- §4 `disabled_when` — DOM 신호(disabled/v-if/aria-hidden 등)는 자동, 변수 기반 동적 조건은 사람·LLM 보완
- §4 `연결 API` — `api_hints` 매칭 안 된 항목(`[매칭 INF 없음]` 표시): handler 함수 안에서 동적 URL 생성하는 경우 — 사람 보완
- §3 블록 정의의 실제 영역 분할 — 사람 검수 (capture.js auto-annotate 보강 가능)
- §7 화면 전환의 실제 다음 화면 — RTM 매핑 후
- §8 조건부 렌더링 — DOM 정적 신호 외 변수 기반 조건은 사람·LLM 보완

---

> 자동 생성 도구 (Phase 6.4 U6~U11 완비):
> - 캡처: `capture.js --tabs=auto --auto-annotate` (DOM 메타 11종 + api_hints + condition_hints dump)
> - spec.md: `generate_uis_spec.py` (§4 풀자동 + §5 INF cross-link + §8 조건 신호 자동)
> - INF cross-link 매칭률은 §5 표에서 `[매칭 INF 없음]` 항목 수로 확인
''')

    return '\n'.join(parts), gaps


def main():
    p = argparse.ArgumentParser()
    p.add_argument('ui_dir')
    p.add_argument('--uis-id', required=True)
    p.add_argument('--screen-id', required=True)
    p.add_argument('--screen-name', required=True)
    p.add_argument('--route', required=True)
    p.add_argument('--domain', required=True)
    p.add_argument('--out', default='spec.md')
    p.add_argument('--workspace', default=None,
                   help='workspace root (기본: ui_dir에서 docs/ 위로 자동 추정)')
    args = p.parse_args()

    ui_dir = os.path.abspath(args.ui_dir)
    workspace_root = os.path.abspath(args.workspace) if args.workspace else None

    spec_md, gaps = build_spec(
        ui_dir, args.uis_id, args.screen_id, args.screen_name,
        args.route, args.domain, workspace_root=workspace_root,
    )

    out_path = args.out if os.path.isabs(args.out) else os.path.join(ui_dir, args.out)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(spec_md)
    print(f'spec.md 생성: {out_path} ({len(spec_md)} chars)')

    # INF gaps 파일 출력 (_tmp/{screen_id}_inf_gaps.json)
    if workspace_root is None:
        workspace_root = _find_workspace_root(ui_dir)
    tmp_dir = os.path.join(workspace_root, '_tmp')
    os.makedirs(tmp_dir, exist_ok=True)
    gaps_path = os.path.join(tmp_dir, f'{args.screen_id}_inf_gaps.json')
    with open(gaps_path, 'w', encoding='utf-8') as f:
        json.dump({
            'screen_id': args.screen_id,
            'uis_id':    args.uis_id,
            'gaps':      gaps,
        }, f, ensure_ascii=False, indent=2)
    if gaps:
        print(f'INF gaps: {gaps_path} ({len(gaps)}건) ← ddd-api-agent 입력으로 사용')
    else:
        print(f'INF gaps: {gaps_path} (0 gaps - all api_hints matched)')


if __name__ == '__main__':
    main()
