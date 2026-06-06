# STATUS: 완료
"""
merge_index.py — RECON 색인 머징기

도메인별 INF/SCH/UIS 파일과 _TOC.md를 스캔해서 전체 색인 3종을 생성한다.
LLM 호출 없이 단순 마크다운 파싱 + 머징.

생성:
- docs/05_설계서/API_Design.md
- docs/05_설계서/DB_Schema.md
- docs/05_설계서/UI_Spec_v1.0.md

사용법:
  python3 merge_index.py [workspace_root]

전제 조건:
  - docs/05_설계서/_domain_plan.json (Phase-A 결과)
  - 도메인별 INF/, DB_{domain}.md, UI/ 구조 존재
"""
import json
import os
import re
import sys
from datetime import datetime

WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
DOCS = os.path.join(WS, 'docs', '05_설계서')
PLAN_PATH = os.path.join(DOCS, '_domain_plan.json')
ENV_PATH = os.path.join(WS, 'project.env')


def read_env():
    if not os.path.exists(ENV_PATH):
        return {}
    out = {}
    for line in open(ENV_PATH, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip()
    return out


def read_frontmatter(path):
    """파일 상단 --- ... --- 블록을 dict으로 반환"""
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


def first_h1_after_frontmatter(path):
    """파일의 첫 # 헤더 텍스트 (frontmatter 제외) 반환"""
    if not os.path.exists(path):
        return None
    txt = open(path, encoding='utf-8').read()
    txt = re.sub(r'^---.*?---\s*\n', '', txt, count=1, flags=re.S)
    m = re.search(r'^#\s+(.+)$', txt, re.M)
    return m.group(1).strip() if m else None


def collect_inf(domain):
    """도메인의 INF 디렉토리에서 INF-NNN.md 항목 수집"""
    inf_dir = os.path.join(DOCS, domain, 'INF')
    if not os.path.isdir(inf_dir):
        return []
    rows = []
    for fname in sorted(os.listdir(inf_dir)):
        if not (fname.startswith('INF-') and fname.endswith('.md')):
            continue
        fp = os.path.join(inf_dir, fname)
        fm = read_frontmatter(fp)
        inf_id = fm.get('inf-id') or fname.replace('.md', '')
        method = fm.get('method', '?')
        path = fm.get('path', '?')
        req_f = fm.get('req-f', '[TBD]')
        title = first_h1_after_frontmatter(fp) or f'{method} {path}'
        # H1에서 — 뒤의 기능명만 추출
        m = re.search(r'—\s*(.+?)\s*$', title)
        feature_name = m.group(1) if m else f'{method} {path}'
        rows.append({
            'id': inf_id,
            'method': method,
            'path': path,
            'feature': feature_name,
            'req_f': req_f,
            'rel_path': f'./{domain}/INF/{fname}',
        })
    return rows


def collect_sch(domain):
    """도메인의 SCH/ 디렉토리에서 개별 SCH-*.md 파일을 수집 (테이블당 1파일 구조)"""
    sch_dir = os.path.join(DOCS, domain, 'SCH')
    if not os.path.isdir(sch_dir):
        return []
    schs = []
    for fname in sorted(os.listdir(sch_dir)):
        if not (fname.startswith('SCH-') and fname.endswith('.md')):
            continue
        path = os.path.join(sch_dir, fname)
        fm = read_frontmatter(path)
        sch_id = (fm.get('sch-id') or fname[:-3]).strip()
        table = (fm.get('table') or '').strip().strip("\"'")
        raw_inf = (fm.get('inf') or '').strip()
        if raw_inf.startswith('[') and raw_inf.endswith(']'):
            raw_inf = raw_inf[1:-1]
        inf_refs = [x.strip() for x in raw_inf.split(',') if x.strip()]
        # frontmatter에 없으면 본문에서 보강 (H1 테이블명 / INF 참조)
        if not table or not inf_refs:
            txt = open(path, encoding='utf-8').read()
            if not table:
                hm = re.search(r'^#\s+SCH-[\w-]+\s*[:\-]+\s*(\S+)', txt, re.M)
                if hm:
                    table = hm.group(1)
            if not inf_refs:
                inf_refs = sorted(set(re.findall(r'INF-[A-Z]*-?\d+', txt)))
        schs.append({
            'id': sch_id,
            'table': table,
            'inf_refs': inf_refs,
            'rel_path': f'./{domain}/SCH/{sch_id}.md',
        })
    return schs


def collect_uis(domain):
    """도메인의 화면 디렉토리에서 spec.md 항목 수집 (현행 'UIS' 우선, 구버전 'UI' 하위호환)"""
    ui_dir, ui_dirname = None, None
    for cand in ('UIS', 'UI'):
        p = os.path.join(DOCS, domain, cand)
        if os.path.isdir(p):
            ui_dir, ui_dirname = p, cand
            break
    if not ui_dir:
        return []
    rows = []
    for screen_dir in sorted(os.listdir(ui_dir)):
        spec_path = os.path.join(ui_dir, screen_dir, 'spec.md')
        if not os.path.isfile(spec_path):
            continue
        fm = read_frontmatter(spec_path)
        uis_id = fm.get('UIS-ID') or fm.get('uis-id')
        if not uis_id:
            continue
        screen_name = fm.get('화면명') or fm.get('screen-name') or screen_dir
        req_f = fm.get('req-f') or '[TBD]'
        rows.append({
            'id': uis_id,
            'name': screen_name,
            'req_f': req_f,
            'rel_path': f'./{domain}/{ui_dirname}/{screen_dir}/spec.md',
        })
    return rows


def domain_files_table(domains):
    """도메인별 파일 nav 테이블"""
    out = ['| 도메인 | API 색인 | DB 스키마 | UI 색인 |',
           '|--------|---------|----------|--------|']
    for d in domains:
        dn = d['name']
        api_p = f'./{dn}/API_{dn}.md'
        db_p = f'./{dn}/DB_{dn}.md'
        ui_p = f'./{dn}/UIS/_TOC.md'
        out.append(f'| {dn} | [API_{dn}.md]({api_p}) | [DB_{dn}.md]({db_p}) | [_TOC.md]({ui_p}) |')
    return '\n'.join(out)


def generate_api_design(project_name, domains, all_inf):
    lines = [
        f'# API 설계서 — {project_name}',
        '',
        '> 자동 생성 (merge_index.py) — 직접 편집 금지',
        '',
        '## INF 색인',
        '',
        '| INF-ID | 엔드포인트·기능명 | FUNC-ID |',
        '|--------|-----------------|------------------|',
    ]
    for inf in all_inf:
        title = f'{inf["method"]} {inf["path"]} — {inf["feature"]}'
        lines.append(f'| {inf["id"]} | [{title}]({inf["rel_path"]}) | {inf["req_f"]} |')

    lines += ['', '## 도메인별 파일 목록', '', domain_files_table(domains), '']
    return '\n'.join(lines)


def generate_db_schema(project_name, domains, all_sch):
    lines = [
        f'# DB 스키마 설계서 — {project_name}',
        '',
        '> 자동 생성 (merge_index.py) — 직접 편집 금지',
        '',
        '## 스키마 색인',
        '',
        '| SCH-ID | 테이블명 | INF-ID |',
        '|--------|---------|--------|',
    ]
    for sch in all_sch:
        inf_str = ', '.join(sch['inf_refs']) if sch['inf_refs'] else '—'
        lines.append(f'| {sch["id"]} | [{sch["table"]}]({sch["rel_path"]}) | {inf_str} |')

    lines += ['', '## 도메인별 파일 목록', '', domain_files_table(domains), '']
    return '\n'.join(lines)


def generate_ui_spec(project_name, domains, all_uis):
    lines = [
        f'# UI 화면 명세 — {project_name}',
        '',
        '> 자동 생성 (merge_index.py) — 직접 편집 금지',
        '',
        '## 화면 색인',
        '',
        '| UIS-ID | 화면명 | FUNC-ID |',
        '|--------|--------|------------------|',
    ]
    for u in all_uis:
        lines.append(f'| {u["id"]} | [{u["name"]}]({u["rel_path"]}) | {u["req_f"]} |')

    lines += ['', '## 도메인별 파일 목록', '', domain_files_table(domains), '']
    return '\n'.join(lines)


def main():
    if not os.path.exists(PLAN_PATH):
        print(f'[ERROR] _domain_plan.json 없음: {PLAN_PATH}', file=sys.stderr)
        sys.exit(1)

    env = read_env()
    project_name = env.get('PROJECT_NAME', os.path.basename(WS))
    plan = json.load(open(PLAN_PATH, encoding='utf-8'))
    domains = plan.get('domains', [])

    all_inf, all_sch, all_uis = [], [], []
    summary = []
    for d in domains:
        dn = d['name']
        infs = collect_inf(dn)
        schs = collect_sch(dn)
        uiss = collect_uis(dn)
        all_inf += infs
        all_sch += schs
        all_uis += uiss
        summary.append((dn, len(infs), len(schs), len(uiss)))

    # ID 순 정렬
    def id_key(x):
        m = re.search(r'(\d+)', x['id'])
        return int(m.group(1)) if m else 0

    all_inf.sort(key=id_key)
    all_sch.sort(key=id_key)
    all_uis.sort(key=id_key)

    api_md = generate_api_design(project_name, domains, all_inf)
    db_md = generate_db_schema(project_name, domains, all_sch)
    ui_md = generate_ui_spec(project_name, domains, all_uis)

    with open(os.path.join(DOCS, 'API_Design.md'), 'w', encoding='utf-8') as f:
        f.write(api_md)
    with open(os.path.join(DOCS, 'DB_Schema.md'), 'w', encoding='utf-8') as f:
        f.write(db_md)
    with open(os.path.join(DOCS, 'UI_Spec_v1.0.md'), 'w', encoding='utf-8') as f:
        f.write(ui_md)

    print(f'== merge_index 완료 ({datetime.now().isoformat(timespec="seconds")}) ==')
    print(f'프로젝트: {project_name}')
    print(f'도메인: {len(domains)}개')
    print(f'{"도메인":<20} {"INF":>5} {"SCH":>5} {"UIS":>5}')
    print('-' * 40)
    for dn, ni, ns, nu in summary:
        print(f'{dn:<20} {ni:>5} {ns:>5} {nu:>5}')
    print('-' * 40)
    print(f'{"합계":<20} {len(all_inf):>5} {len(all_sch):>5} {len(all_uis):>5}')
    print('')
    print('생성:')
    print(f'  - {os.path.join(DOCS, "API_Design.md")}')
    print(f'  - {os.path.join(DOCS, "DB_Schema.md")}')
    print(f'  - {os.path.join(DOCS, "UI_Spec_v1.0.md")}')


if __name__ == '__main__':
    main()
