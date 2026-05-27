"""
build_funcs_index.py — RECON 모드 Phase-C 진입 직전에 실행되는 통합 인덱스 빌더

목적:
  rd-agent / srs-agent / rtm-agent (Opus×3) 가 각자 spec.md + INF/*.md 를 cat 하지 않도록
  사전에 단일 인덱스 파일을 만들어 세 에이전트가 공유한다.

읽기:
  docs/05_설계서/{도메인}/UI/{화면ID}/spec.md
  docs/05_설계서/{도메인}/INF/INF-NNN.md
  docs/05_설계서/_domain_plan.json

생성:
  _tmp/funcs_index.json  ← rd/srs/rtm 공통 인덱스

스키마:
  {
    "version": "1.1",
    "generatedAt": "ISO datetime",
    "domains": ["auth", "order", ...],
    "screens": {
      "UIS-F-001": {
        "screenId": "LoginPage",
        "screenName": "로그인",
        "domain": "auth",
        "route": "/login",
        "specPath": "docs/05_설계서/auth/UI/LoginPage/spec.md",
        "api_hints": [
          {"url": "/auth/login", "method": "POST", "description": "로그인"}
        ]
      }
    },
    "infs": {
      "INF-001": {
        "id": "INF-001",
        "domain": "auth",
        "method": "POST",
        "path": "/auth/login",
        "summary": "로그인",
        "infPath": "docs/05_설계서/auth/INF/INF-001.md",
        "used_by_screens": ["UIS-F-001"]
      }
    },
    "funcs": [
      {
        "id":         "FUNC-auth-001",
        "domain":     "auth",
        "screen":     "LoginPage",
        "screenName": "로그인",
        "specPath":   "docs/05_설계서/auth/UI/LoginPage/spec.md",
        "uisId":      "UIS-F-001",
        "route":      "/login",
        "api_hints":  [{"url": "/auth/login", "method": "POST", "description": "로그인"}],
        "inf": [
          { "id":"INF-001", "method":"POST", "path":"/auth/login",
            "summary":"로그인", "infPath":"docs/05_설계서/auth/INF/INF-001.md",
            "used_by_screens":["UIS-F-001"] }
        ],
        "srs":         ["SRS-F-001"],
        "dbTables":    ["users", "sessions"],
        "rules":       ["..."],
        "reqF":        "[TBD]"
      },
      ...
    ],
    "summary": { "totalFuncs": 1, "byDomain": {"auth": 1} }
  }

사용법:
  python3 build_funcs_index.py [workspace_root]
"""
import json
import os
import re
import sys
from datetime import datetime

WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
DOCS = os.path.join(WS, 'docs', '05_설계서')
PLAN_PATH = os.path.join(DOCS, '_domain_plan.json')
OUT_PATH = os.path.join(WS, '_tmp', 'funcs_index.json')


def read_raw(path):
    if not os.path.exists(path):
        return ''
    # utf-8-sig: BOM 있으면 자동 제거 (PowerShell Set-Content 호환)
    return open(path, encoding='utf-8-sig').read()


def split_frontmatter(text):
    """(frontmatter_text, body_text) 분리. --- 블록 없으면 ('', text)."""
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n?', text, re.S)
    if not m:
        return '', text
    return m.group(1), text[m.end():]


def parse_simple_fm(fm_text):
    """단순 key: value 행 파싱 (중첩 YAML 제외)."""
    out = {}
    for ln in fm_text.splitlines():
        if ':' not in ln or ln.lstrip().startswith('-'):
            continue
        k, v = ln.split(':', 1)
        out[k.strip()] = v.strip()
    return out


def parse_api_hints(fm_text):
    """
    api_hints 블록을 파싱한다. 지원 형식:
      api_hints:
        - { url: "/api/foo", method: "GET", description: "..." }
        - url: /api/bar
          method: POST
    반환: [{"url":..., "method":..., "description":...}, ...]
    """
    # api_hints: 행부터 다음 최상위 키까지 슬라이스
    block_m = re.search(r'^api_hints\s*:\s*\n((?:[ \t]+.+\n?)+)', fm_text, re.M)
    if not block_m:
        return []

    block = block_m.group(1)
    hints = []
    current = {}

    for ln in block.splitlines():
        stripped = ln.lstrip()
        if not stripped:
            continue

        # 새 항목 시작: - { ... } 인라인 형식
        inline_m = re.match(r'-\s*\{(.+?)\}', stripped)
        if inline_m:
            if current:
                hints.append(current)
            current = {}
            for kv in re.finditer(r'(\w+)\s*:\s*"?([^",}]+)"?', inline_m.group(1)):
                current[kv.group(1)] = kv.group(2).strip()
            hints.append(current)
            current = {}
            continue

        # 새 항목 시작: - url: ... 형식
        dash_kv = re.match(r'-\s+(\w+)\s*:\s*(.*)', stripped)
        if dash_kv:
            if current:
                hints.append(current)
            current = {dash_kv.group(1): dash_kv.group(2).strip().strip('"')}
            continue

        # 이어지는 key: value (들여쓰기)
        cont_kv = re.match(r'(\w+)\s*:\s*(.*)', stripped)
        if cont_kv and current:
            current[cont_kv.group(1)] = cont_kv.group(2).strip().strip('"')

    if current:
        hints.append(current)

    # 최소한 url 필드가 있는 항목만 유효
    return [h for h in hints if h.get('url')]


def parse_used_by_screens(fm_text):
    """
    used_by_screens: ["UIS-F-001", "UIS-F-002"] 또는
    used_by_screens:
      - UIS-F-001
    형식을 파싱한다. 구버전 필드명 `screens:` 도 폴백으로 지원한다.
    """
    for field in ('used_by_screens', 'screens'):
        # 인라인 배열 형식
        inline = re.search(rf'^{field}\s*:\s*\[([^\]]*)\]', fm_text, re.M)
        if inline:
            items = re.findall(r'[\w-]+', inline.group(1))
            vals = [i for i in items if i.startswith('UIS-')]
            if vals or inline.group(1).strip() == '':
                return vals  # 빈 배열도 명시적 값으로 인정

        # 블록 목록 형식
        block_m = re.search(rf'^{field}\s*:\s*\n((?:[ \t]+-[^\n]+\n?)+)', fm_text, re.M)
        if block_m:
            return [ln.strip().lstrip('-').strip() for ln in block_m.group(1).splitlines() if ln.strip().lstrip('-').strip()]

    return []


def collect_inf_index(domains_list):
    """
    모든 도메인의 INF/*.md를 스캔해 INF 인덱스를 반환한다.
    반환: { "INF-001": {id, domain, method, path, summary, infPath, used_by_screens} }
    """
    inf_index = {}
    scan_domains = domains_list if domains_list else (
        [d for d in os.listdir(DOCS) if os.path.isdir(os.path.join(DOCS, d))]
        if os.path.isdir(DOCS) else []
    )
    for domain in scan_domains:
        inf_dir = os.path.join(DOCS, domain, 'INF')
        if not os.path.isdir(inf_dir):
            continue
        for fname in sorted(os.listdir(inf_dir)):
            if not fname.endswith('.md'):
                continue
            inf_id = fname[:-3]  # INF-NNN
            fpath = os.path.join(inf_dir, fname)
            raw = read_raw(fpath)
            fm_text, body = split_frontmatter(raw)
            fm = parse_simple_fm(fm_text)

            h1 = re.search(r'^#\s+(.+)$', body, re.M)
            title = h1.group(1).strip() if h1 else ''
            dash_m = re.search(r'—\s*(.+?)\s*$', title)
            feature = dash_m.group(1) if dash_m else (title or f"{fm.get('method','?')} {fm.get('path','?')}")

            inf_index[inf_id] = {
                'id':              inf_id,
                'domain':          domain,
                'method':          fm.get('method', '?'),
                'path':            fm.get('path', '?'),
                'summary':         feature,
                'infPath':         f'docs/05_설계서/{domain}/INF/{fname}',
                'used_by_screens': parse_used_by_screens(fm_text),
            }
    return inf_index


def main():
    if not os.path.exists(PLAN_PATH):
        print(f'[ERROR] _domain_plan.json 없음: {PLAN_PATH}', file=sys.stderr)
        sys.exit(1)

    plan = json.load(open(PLAN_PATH, encoding='utf-8'))
    domains = [d['name'] for d in plan.get('domains', [])]

    # INF 전체 인덱스 (used_by_screens 포함)
    inf_index = collect_inf_index(domains)

    funcs = []
    screens_map = {}          # UIS-ID → screen 메타
    domain_counters = {}
    domain_func_counts = {}

    for domain in sorted(os.listdir(DOCS) if os.path.isdir(DOCS) else []):
        ui_dir = os.path.join(DOCS, domain, 'UI')
        if not os.path.isdir(ui_dir):
            continue
        if domains and domain not in domains:
            continue
        domain_counters.setdefault(domain, 0)
        domain_func_counts.setdefault(domain, 0)

        for screen_id in sorted(os.listdir(ui_dir)):
            spec_path = os.path.join(ui_dir, screen_id, 'spec.md')
            if not os.path.isfile(spec_path):
                continue
            raw = read_raw(spec_path)
            fm_text, body = split_frontmatter(raw)
            fm = parse_simple_fm(fm_text)

            domain_counters[domain] += 1
            func_id = f'FUNC-{domain}-{domain_counters[domain]:03d}'
            uis_id = fm.get('UIS-ID') or fm.get('uis-id') or ''

            # api_hints — spec.md 프론트매터 우선 파싱 (Phase 7.7)
            api_hints = parse_api_hints(fm_text)

            # INF: body의 INF 참조 + INF 인덱스의 used_by_screens 역참조
            ref_inf_ids = sorted(set(re.findall(r'INF-\d+', body)))
            # INF 인덱스에서 이 화면을 used_by_screens로 참조하는 INF도 포함
            if uis_id:
                for iid, meta in inf_index.items():
                    if uis_id in meta['used_by_screens'] and iid not in ref_inf_ids:
                        ref_inf_ids.append(iid)
                ref_inf_ids = sorted(set(ref_inf_ids))

            inf_list = []
            for iid in ref_inf_ids:
                if iid in inf_index:
                    inf_list.append(inf_index[iid])
                else:
                    # INF 파일 미생성 — 기본값
                    inf_list.append({
                        'id':              iid,
                        'domain':          domain,
                        'method':          '?',
                        'path':            '?',
                        'summary':         '(INF 미생성)',
                        'infPath':         f'docs/05_설계서/{domain}/INF/{iid}.md',
                        'used_by_screens': [],
                    })

            # SRS 추출
            srs_ids = sorted(set(re.findall(r'SRS-F-[\w-]+', body)))

            # DB 테이블 (TB_xxx 패턴)
            db_tables = sorted(set(re.findall(r'\bTB_\w+', body)))

            # 비즈니스 규칙 (§3/§5 섹션 다음 bullet)
            rules = []
            for m in re.finditer(r'(?:비즈니스 규칙|Business Rule)[^\n]*\n((?:[-*].+\n?)+)', body):
                for ln in m.group(1).strip().split('\n'):
                    s = ln.strip(' -*').strip()
                    if s:
                        rules.append(s)

            screen_name = fm.get('화면명') or fm.get('screen-name') or screen_id
            route = fm.get('라우트') or fm.get('route') or ''

            func_entry = {
                'id':         func_id,
                'domain':     domain,
                'screen':     screen_id,
                'screenName': screen_name,
                'specPath':   f'docs/05_설계서/{domain}/UI/{screen_id}/spec.md',
                'uisId':      uis_id,
                'route':      route,
                'api_hints':  api_hints,
                'inf':        inf_list,
                'srs':        srs_ids,
                'dbTables':   db_tables,
                'rules':      rules,
                'reqF':       fm.get('REQ-F') or fm.get('req-f') or '[TBD]',
            }
            funcs.append(func_entry)
            domain_func_counts[domain] += 1

            # screens_map 빌드 (UIS-ID 기준 빠른 조회용)
            if uis_id:
                screens_map[uis_id] = {
                    'screenId':   screen_id,
                    'screenName': screen_name,
                    'domain':     domain,
                    'route':      route,
                    'specPath':   f'docs/05_설계서/{domain}/UI/{screen_id}/spec.md',
                    'api_hints':  api_hints,
                }

    out = {
        'version':     '1.1',
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'domains':     domains,
        'screens':     screens_map,        # UIS-ID → screen 메타 (api_hints 포함)
        'infs':        inf_index,          # INF-ID → INF 메타 (used_by_screens 포함)
        'funcs':       funcs,
        'summary': {
            'totalFuncs':   len(funcs),
            'totalScreens': len(screens_map),
            'totalInfs':    len(inf_index),
            'byDomain':     domain_func_counts,
        },
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f'== funcs_index 생성 완료 ({datetime.now().isoformat(timespec="seconds")}) ==')
    print(f'총 기능: {len(funcs)}개 | 화면: {len(screens_map)}개 | INF: {len(inf_index)}개')
    print(f'{"도메인":<20} {"기능 수":>8}')
    print('-' * 30)
    for d, c in sorted(domain_func_counts.items()):
        print(f'{d:<20} {c:>8}')
    print(f'\n저장: {OUT_PATH}')


if __name__ == '__main__':
    main()
