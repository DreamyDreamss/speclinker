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
    "version": "1.0",
    "generatedAt": "ISO datetime",
    "domains": ["auth", "order", ...],
    "funcs": [
      {
        "id":         "FUNC-auth-001",
        "domain":     "auth",
        "screen":     "LoginPage",
        "screenName": "로그인",
        "specPath":   "docs/05_설계서/auth/UI/LoginPage/spec.md",
        "uisId":      "UIS-F-001",
        "route":      "/login",
        "inf": [
          { "id":"INF-001", "method":"POST", "path":"/auth/login",
            "summary":"로그인", "infPath":"docs/05_설계서/auth/INF/INF-001.md" }
        ],
        "srs":         ["SRS-F-001"],
        "dbTables":    ["users", "sessions"],
        "rules":       ["..."],
        "reqF":        "[TBD]"
      },
      ...
    ]
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


def read_frontmatter_dict(path):
    if not os.path.exists(path):
        return {}
    txt = open(path, encoding='utf-8').read()
    m = re.match(r'^---\s*\n(.*?)\n---', txt, re.S)
    if not m:
        return {}
    out = {}
    for ln in m.group(1).splitlines():
        if ':' not in ln:
            continue
        k, v = ln.split(':', 1)
        out[k.strip()] = v.strip()
    return out


def read_body(path):
    if not os.path.exists(path):
        return ''
    txt = open(path, encoding='utf-8').read()
    return re.sub(r'^---.*?---\s*\n', '', txt, count=1, flags=re.S)


def extract_inf_meta(domain, inf_id):
    """INF 파일에서 method, path, 기능명 추출"""
    inf_path = os.path.join(DOCS, domain, 'INF', f'{inf_id}.md')
    if not os.path.exists(inf_path):
        return {'id': inf_id, 'method': '?', 'path': '?', 'summary': '(INF 미생성)',
                'infPath': f'docs/05_설계서/{domain}/INF/{inf_id}.md'}
    fm = read_frontmatter_dict(inf_path)
    body = read_body(inf_path)
    h1 = re.search(r'^#\s+(.+)$', body, re.M)
    title = h1.group(1).strip() if h1 else ''
    feature = ''
    if title:
        m = re.search(r'—\s*(.+?)\s*$', title)
        feature = m.group(1) if m else title
    return {
        'id':      inf_id,
        'method':  fm.get('method', '?'),
        'path':    fm.get('path', '?'),
        'summary': feature or f"{fm.get('method','?')} {fm.get('path','?')}",
        'infPath': f'docs/05_설계서/{domain}/INF/{inf_id}.md',
    }


def main():
    if not os.path.exists(PLAN_PATH):
        print(f'[ERROR] _domain_plan.json 없음: {PLAN_PATH}', file=sys.stderr)
        sys.exit(1)

    plan = json.load(open(PLAN_PATH, encoding='utf-8'))
    domains = [d['name'] for d in plan.get('domains', [])]

    funcs = []
    domain_counters = {}
    domain_func_counts = {}

    for domain in sorted(os.listdir(DOCS) if os.path.isdir(DOCS) else []):
        ui_dir = os.path.join(DOCS, domain, 'UI')
        if not os.path.isdir(ui_dir):
            continue
        if domain not in domains:
            # plan에 없는 도메인은 스킵 (단, plan이 비었으면 모두 포함)
            if domains:
                continue
        domain_counters.setdefault(domain, 0)
        domain_func_counts.setdefault(domain, 0)

        for screen_id in sorted(os.listdir(ui_dir)):
            spec_path = os.path.join(ui_dir, screen_id, 'spec.md')
            if not os.path.isfile(spec_path):
                continue
            fm = read_frontmatter_dict(spec_path)
            body = read_body(spec_path)

            domain_counters[domain] += 1
            func_id = f'FUNC-{domain}-{domain_counters[domain]:03d}'

            # INF 추출
            inf_ids = sorted(set(re.findall(r'INF-\d+', body)))
            inf_list = [extract_inf_meta(domain, iid) for iid in inf_ids]

            # SRS 추출
            srs_ids = sorted(set(re.findall(r'SRS-F-[\w-]+', body)))

            # DB 테이블 (TB_xxx 패턴)
            db_tables = sorted(set(re.findall(r'\bTB_\w+', body)))

            # 비즈니스 규칙 (heuristic — §3 또는 §5 섹션 다음 bullet들)
            rules = []
            for m in re.finditer(r'(?:비즈니스 규칙|Business Rule)[^\n]*\n((?:[-*].+\n?)+)', body):
                for ln in m.group(1).strip().split('\n'):
                    s = ln.strip(' -*').strip()
                    if s:
                        rules.append(s)

            funcs.append({
                'id':         func_id,
                'domain':     domain,
                'screen':     screen_id,
                'screenName': fm.get('화면명') or fm.get('screen-name') or screen_id,
                'specPath':   f'docs/05_설계서/{domain}/UI/{screen_id}/spec.md',
                'uisId':      fm.get('UIS-ID') or fm.get('uis-id') or '',
                'route':      fm.get('라우트') or fm.get('route') or '',
                'inf':        inf_list,
                'srs':        srs_ids,
                'dbTables':   db_tables,
                'rules':      rules,
                'reqF':       fm.get('REQ-F') or fm.get('req-f') or '[TBD]',
            })
            domain_func_counts[domain] += 1

    out = {
        'version':     '1.0',
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'domains':     domains,
        'funcs':       funcs,
        'summary': {
            'totalFuncs':   len(funcs),
            'byDomain':     domain_func_counts,
        },
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f'== funcs_index 생성 완료 ({datetime.now().isoformat(timespec="seconds")}) ==')
    print(f'총 기능: {len(funcs)}개')
    print(f'{"도메인":<20} {"기능 수":>8}')
    print('-' * 30)
    for d, c in sorted(domain_func_counts.items()):
        print(f'{d:<20} {c:>8}')
    print(f'\n저장: {OUT_PATH}')


if __name__ == '__main__':
    main()
