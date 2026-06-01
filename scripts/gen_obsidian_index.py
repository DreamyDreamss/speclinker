#!/usr/bin/env python3
"""
gen_obsidian_index.py — 스펙 문서 Obsidian 인덱스 생성기

1. docs/05_설계서/ 전체 스캔
2. 각 spec.md에 YAML frontmatter + [[links]] 삽입
3. docs/05_설계서/_INDEX.md (도메인 매트릭스) 생성
4. .obsidian/ 폴더 생성 (Obsidian 자동인식)

Usage:
  python3 gen_obsidian_index.py [workspace]
"""
import sys, os, re, json
from collections import defaultdict
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
DESIGN_ROOT = os.path.join(WS, 'docs', '05_설계서')

# ── 스펙 파일 스캔 ─────────────────────────────────────────────────────────────

def scan_specs():
    """도메인별 UIS/INF/SCH/BAT 스펙 파일 목록 반환."""
    result = defaultdict(lambda: {'uis': [], 'inf': [], 'sch': [], 'bat': []})

    if not os.path.isdir(DESIGN_ROOT):
        return result

    for domain in sorted(os.listdir(DESIGN_ROOT)):
        domain_dir = os.path.join(DESIGN_ROOT, domain)
        if not os.path.isdir(domain_dir) or domain.startswith('_') or domain.startswith('.'):
            continue

        # UIS: UIS-*/spec.md (UI/ 하위 or 직접)
        for sub in ('UI', 'UIS', '.'):
            sub_dir = os.path.join(domain_dir, sub) if sub != '.' else domain_dir
            if not os.path.isdir(sub_dir):
                continue
            for entry in sorted(os.listdir(sub_dir)):
                entry_path = os.path.join(sub_dir, entry)
                spec_md = os.path.join(entry_path, 'spec.md')
                if os.path.isdir(entry_path) and re.match(r'UIS-', entry) and os.path.exists(spec_md):
                    m = re.match(r'(UIS-[\w-]+)', entry)
                    uis_id = m.group(1) if m else entry
                    result[domain]['uis'].append({
                        'id': uis_id,
                        'dirName': entry,
                        'path': spec_md,
                        'relPath': os.path.relpath(spec_md, DESIGN_ROOT),
                        'preview': os.path.join(entry_path, 'preview.png'),
                    })

        # INF: INF-*.md
        inf_dir = os.path.join(domain_dir, 'INF')
        if os.path.isdir(inf_dir):
            for fname in sorted(os.listdir(inf_dir)):
                if re.match(r'INF-[\w-]+\.md$', fname) and not fname.startswith('_'):
                    fpath = os.path.join(inf_dir, fname)
                    inf_id = fname[:-3]
                    body = _read(fpath) or ''
                    method = (re.search(r'^method:\s*(\S+)', body, re.M) or type('', (), {'group': lambda s,i: '?'})()).group(1)
                    path_val = (re.search(r'^path:\s*(\S+)', body, re.M) or type('', (), {'group': lambda s,i: '?'})()).group(1)
                    result[domain]['inf'].append({
                        'id': inf_id,
                        'path': fpath,
                        'relPath': os.path.relpath(fpath, DESIGN_ROOT),
                        'method': method,
                        'endpoint': path_val,
                    })

        # SCH: SCH-*.md 또는 DB_*.md
        sch_dir = os.path.join(domain_dir, 'SCH')
        for search_dir, pat in [(sch_dir, r'SCH-[\w-]+\.md$'), (domain_dir, r'(SCH-[\w-]+|DB_.+)\.md$')]:
            if not os.path.isdir(search_dir):
                continue
            for fname in sorted(os.listdir(search_dir)):
                if re.match(pat, fname) and not fname.startswith('_'):
                    fpath = os.path.join(search_dir, fname)
                    sch_id = fname[:-3]
                    result[domain]['sch'].append({
                        'id': sch_id,
                        'path': fpath,
                        'relPath': os.path.relpath(fpath, DESIGN_ROOT),
                    })
            break  # SCH/ 있으면 domain_dir 스캔 안 함

        # BAT: BAT-*.md
        bat_dir = os.path.join(domain_dir, 'BAT')
        if os.path.isdir(bat_dir):
            for fname in sorted(os.listdir(bat_dir)):
                if re.match(r'BAT-[\w-]+\.md$', fname) and not fname.startswith('_'):
                    fpath = os.path.join(bat_dir, fname)
                    result[domain]['bat'].append({
                        'id': fname[:-3],
                        'path': fpath,
                        'relPath': os.path.relpath(fpath, DESIGN_ROOT),
                    })

    return result

# ── INF↔UIS 교차 참조 빌드 ──────────────────────────────────────────────────

def build_cross_refs(specs):
    """UIS spec.md 내 INF 링크 파싱 → uis_to_inf, inf_to_uis 맵."""
    uis_to_inf = defaultdict(list)   # uis_id → [inf_id, ...]
    inf_to_uis = defaultdict(list)   # inf_id → [uis_id, ...]

    for domain, buckets in specs.items():
        for uis in buckets['uis']:
            body = _read(uis['path']) or ''
            # 기존 link_uis_inf.py가 삽입한 링크: [INF-XXX-NNN](../../INF/INF-XXX-NNN.md)
            found = re.findall(r'\[(INF-[\w-]+)\]\([^)]+\.md\)', body)
            # [[INF-XXX-NNN]] 형식도
            found += re.findall(r'\[\[(INF-[\w-]+)[|\]]', body)
            for inf_id in found:
                if inf_id not in uis_to_inf[uis['id']]:
                    uis_to_inf[uis['id']].append(inf_id)
                if uis['id'] not in inf_to_uis[inf_id]:
                    inf_to_uis[inf_id].append(uis['id'])

    return uis_to_inf, inf_to_uis


def build_sch_cross_refs(specs):
    """INF spec 내 [[SCH-XXX]] 링크 파싱 → inf_to_sch, sch_to_inf 맵."""
    inf_to_sch = defaultdict(list)
    sch_to_inf = defaultdict(list)

    for domain, buckets in specs.items():
        for inf in buckets['inf']:
            body = _read(inf['path']) or ''
            # [[SCH-XXX]] inserted by link_inf_sch.py in 참조 테이블 section
            found = re.findall(r'\[\[(SCH-[\w-]+)\]\]', body)
            # [SCH-XXX](path) markdown links
            found += re.findall(r'\[(SCH-[\w-]+)\]\([^)]+\.md\)', body)
            seen = set()
            for sch_id in found:
                if sch_id not in seen:
                    seen.add(sch_id)
                    inf_to_sch[inf['id']].append(sch_id)
                    if inf['id'] not in sch_to_inf[sch_id]:
                        sch_to_inf[sch_id].append(inf['id'])

    return inf_to_sch, sch_to_inf

# ── YAML frontmatter 삽입/갱신 ──────────────────────────────────────────────

def upsert_frontmatter(path, fields: dict):
    """spec.md 상단 YAML frontmatter 추가/갱신. 기존 내용 보존."""
    body = _read(path) or ''

    # 기존 frontmatter 제거
    fm_match = re.match(r'^---\n(.*?)\n---\n', body, re.DOTALL)
    existing = {}
    if fm_match:
        for line in fm_match.group(1).splitlines():
            kv = line.split(':', 1)
            if len(kv) == 2:
                existing[kv[0].strip()] = kv[1].strip()
        body = body[fm_match.end():]

    # fields 병합 (신규 우선)
    merged = {**existing, **fields}

    def fmt_val(v):
        if isinstance(v, list):
            if not v:
                return '[]'
            return '\n' + ''.join(f'  - {item}\n' for item in v)
        return str(v)

    fm_lines = ['---']
    for k, v in merged.items():
        val = fmt_val(v)
        if val.startswith('\n'):
            fm_lines.append(f'{k}:{val}')
        else:
            fm_lines.append(f'{k}: {val}')
    fm_lines.append('---')
    fm_lines.append('')

    new_body = '\n'.join(fm_lines) + body
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_body)

# ── 연관 스펙 섹션 추가 ─────────────────────────────────────────────────────

def upsert_related_section(path, related_lines: list):
    """## 연관 스펙 섹션 추가/갱신. 없으면 파일 끝에 추가."""
    if not related_lines:
        return
    body = _read(path) or ''

    section_header = '## 연관 스펙'
    section = '\n' + section_header + '\n' + '\n'.join(related_lines) + '\n'

    if section_header in body:
        # 기존 섹션 교체
        body = re.sub(
            r'\n## 연관 스펙\n.*?(?=\n## |\Z)',
            section,
            body, flags=re.DOTALL
        )
    else:
        body = body.rstrip() + '\n' + section

    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

# ── 스펙 파일 보강 ─────────────────────────────────────────────────────────

def enrich_uis(uis_entry, domain, linked_infs):
    """UIS spec.md에 frontmatter + 연관 스펙 섹션 삽입."""
    path = uis_entry['path']
    if not os.path.exists(path):
        return

    fm = {
        'spec-type': 'UIS',
        'spec-id': uis_entry['id'],
        'domain': domain,
        'tags': [domain, 'UIS'],
    }
    if linked_infs:
        fm['linked-inf'] = linked_infs

    has_preview = os.path.exists(uis_entry['preview'])
    if has_preview:
        fm['preview'] = './preview.png'

    upsert_frontmatter(path, fm)

    related = []
    for inf_id in linked_infs:
        related.append(f'- [[{inf_id}]]')
    if related:
        upsert_related_section(path, related)


def enrich_inf(inf_entry, domain, linked_uis, linked_sch=None):
    """INF-XXX.md에 frontmatter + 연관 스펙 섹션 삽입."""
    path = inf_entry['path']
    if not os.path.exists(path):
        return

    fm = {
        'spec-type': 'INF',
        'spec-id': inf_entry['id'],
        'domain': domain,
        'tags': [domain, 'INF'],
    }
    if inf_entry.get('method') and inf_entry['method'] != '?':
        fm['method'] = inf_entry['method']
    if inf_entry.get('endpoint') and inf_entry['endpoint'] != '?':
        fm['endpoint'] = inf_entry['endpoint']
    if linked_uis:
        fm['linked-uis'] = linked_uis
    if linked_sch:
        fm['linked-sch'] = linked_sch

    upsert_frontmatter(path, fm)

    related = []
    for uis_id in linked_uis:
        related.append(f'- [[{uis_id}]]')
    for sch_id in (linked_sch or []):
        related.append(f'- [[{sch_id}]]')
    if related:
        upsert_related_section(path, related)


def enrich_sch(sch_entry, domain, linked_infs=None):
    """SCH-XXX.md에 frontmatter + 연관 스펙 섹션 삽입."""
    path = sch_entry['path']
    if not os.path.exists(path):
        return

    fm = {
        'spec-type': 'SCH',
        'spec-id': sch_entry['id'],
        'domain': domain,
        'tags': [domain, 'SCH'],
    }
    if linked_infs:
        fm['linked-inf'] = linked_infs

    upsert_frontmatter(path, fm)

    if linked_infs:
        related = [f'- [[{inf_id}]]' for inf_id in linked_infs]
        upsert_related_section(path, related)

# ── _INDEX.md 생성 ──────────────────────────────────────────────────────────

def generate_index(specs, inf_to_sch=None, sch_to_inf=None):
    index_path = os.path.join(DESIGN_ROOT, '_INDEX.md')
    inf_to_sch = inf_to_sch or {}
    sch_to_inf = sch_to_inf or {}

    total_uis = sum(len(v['uis']) for v in specs.values())
    total_inf = sum(len(v['inf']) for v in specs.values())
    total_sch = sum(len(v['sch']) for v in specs.values())
    total_bat = sum(len(v['bat']) for v in specs.values())
    total_linked_inf = sum(1 for v in specs.values() for inf in v['inf'] if inf_to_sch.get(inf['id']))

    lines = [
        '# 스펙 문서 인덱스',
        '',
        f'> 생성: {datetime.now().strftime("%Y-%m-%d %H:%M")} | '
        f'도메인 {len(specs)}개 | UIS {total_uis}개 | INF {total_inf}개 | '
        f'SCH {total_sch}개 | BAT {total_bat}개 | INF↔SCH 링크 {total_linked_inf}/{total_inf}',
        '',
        '## 도메인 맵',
        '',
        '| 도메인 | UIS | INF | SCH | BAT | INF↔SCH |',
        '|--------|:---:|:---:|:---:|:---:|:-------:|',
    ]

    for domain, buckets in sorted(specs.items()):
        u = len(buckets['uis'])
        i = len(buckets['inf'])
        s = len(buckets['sch'])
        b = len(buckets['bat'])
        linked = sum(1 for inf in buckets['inf'] if inf_to_sch.get(inf['id']))
        u_str = f'[{u}]({domain}/UI/_INDEX.md)' if u else '—'
        i_str = f'[{i}]({domain}/INF/_TOC.md)' if i else '—'
        s_str = f'[{s}]({domain}/SCH/)' if s else '—'
        b_str = f'[{b}]({domain}/BAT/)' if b else '—'
        cov_str = f'{linked}/{i}' if i else '—'
        lines.append(f'| **{domain}** | {u_str} | {i_str} | {s_str} | {b_str} | {cov_str} |')

    lines += ['', '---', '', '## 도메인별 화면 목록', '']

    for domain, buckets in sorted(specs.items()):
        if not buckets['uis']:
            continue
        lines.append(f'### {domain}')
        lines.append('')
        for uis in buckets['uis']:
            label = uis['dirName'].replace(uis['id'] + '_', '')
            lines.append(f'- [[{uis["id"]}]] {label}')
        lines.append('')

    # Unlinked INF summary (INF without SCH refs)
    unlinked = []
    for domain, buckets in sorted(specs.items()):
        for inf in buckets['inf']:
            if not inf_to_sch.get(inf['id']):
                unlinked.append((domain, inf['id'], inf.get('endpoint', '?')))

    if unlinked:
        lines += ['---', '', '## SCH 미링크 INF 목록', '',
                  '> `link_inf_sch.py` 실행 또는 DB_Schema.md 생성 후 재실행하면 자동 연결됩니다.', '',
                  '| 도메인 | INF-ID | 엔드포인트 |',
                  '|--------|--------|-----------|']
        for domain, inf_id, ep in unlinked:
            lines.append(f'| {domain} | [[{inf_id}]] | {ep} |')
        lines.append('')

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    return index_path

# ── Obsidian .obsidian 폴더 ──────────────────────────────────────────────────

def init_obsidian_vault():
    obsidian_dir = os.path.join(DESIGN_ROOT, '.obsidian')
    os.makedirs(obsidian_dir, exist_ok=True)

    # 최소 app.json: Obsidian이 이 폴더를 vault로 인식
    app_json = os.path.join(obsidian_dir, 'app.json')
    if not os.path.exists(app_json):
        with open(app_json, 'w', encoding='utf-8') as f:
            f.write('{}')

    # UIS 파일이 spec.md 디렉토리 안에 있으므로 wikilink 해석 범위 설정
    config_path = os.path.join(obsidian_dir, 'config')
    if not os.path.exists(config_path):
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump({
                'newFileLocation': 'folder',
                'attachmentFolderPath': './',
                'useMarkdownLinks': False,
                'showUnsupportedFiles': False,
            }, f, ensure_ascii=False, indent=2)

# ── 유틸 ────────────────────────────────────────────────────────────────────

def _read(path):
    try:
        return open(path, encoding='utf-8').read()
    except Exception:
        return None

# ── 메인 ────────────────────────────────────────────────────────────────────

def main():
    if not os.path.isdir(DESIGN_ROOT):
        print(f'[ERROR] {DESIGN_ROOT} 없음 — SDD 생성 후 실행하세요')
        sys.exit(1)

    print('[Obsidian 인덱서] 스캔 중...')
    specs = scan_specs()

    total = sum(len(v['uis']) + len(v['inf']) + len(v['sch']) + len(v['bat'])
                for v in specs.values())
    print(f'  발견: {len(specs)}개 도메인, {total}개 스펙 파일')

    print('[1/4] 교차 참조 빌드...')
    uis_to_inf, inf_to_uis = build_cross_refs(specs)
    inf_to_sch, sch_to_inf = build_sch_cross_refs(specs)
    sch_linked = sum(len(v) for v in inf_to_sch.values())
    print(f'  UIS↔INF: {sum(len(v) for v in uis_to_inf.values())}개 링크 | INF↔SCH: {sch_linked}개 링크')

    print('[2/4] 스펙 파일 frontmatter + [[links]] 삽입...')
    enriched = 0
    for domain, buckets in specs.items():
        for uis in buckets['uis']:
            enrich_uis(uis, domain, uis_to_inf.get(uis['id'], []))
            enriched += 1
        for inf in buckets['inf']:
            enrich_inf(inf, domain, inf_to_uis.get(inf['id'], []),
                       linked_sch=inf_to_sch.get(inf['id'], []))
            enriched += 1
        for sch in buckets['sch']:
            enrich_sch(sch, domain, linked_infs=sch_to_inf.get(sch['id'], []))
            enriched += 1
    print(f'  처리: {enriched}개 파일')

    print('[3/4] _INDEX.md 생성...')
    index_path = generate_index(specs, inf_to_sch, sch_to_inf)
    print(f'  → {index_path}')

    print('[4/4] .obsidian/ 초기화...')
    init_obsidian_vault()
    print(f'  → {os.path.join(DESIGN_ROOT, ".obsidian/")}')

    print()
    print('완료. Obsidian에서 아래 폴더를 vault로 열어보세요:')
    print(f'  {DESIGN_ROOT}')
    print()
    print('도메인 맵: _INDEX.md')
    print('그래프 뷰: 스펙 간 [[links]] 연결 시각화')

    # AIDD용 spec_graph.json 생성 (func_context_bundle.py가 참조)
    graph = {}
    for domain, buckets in specs.items():
        for uis in buckets['uis']:
            graph[uis['id']] = {
                'type': 'UIS', 'domain': domain,
                'path': uis['relPath'],
                'linked': {'inf': uis_to_inf.get(uis['id'], [])},
            }
        for inf in buckets['inf']:
            graph[inf['id']] = {
                'type': 'INF', 'domain': domain,
                'path': inf['relPath'],
                'linked': {
                    'uis': inf_to_uis.get(inf['id'], []),
                    'sch': inf_to_sch.get(inf['id'], []),
                },
            }
        for sch in buckets['sch']:
            graph[sch['id']] = {
                'type': 'SCH', 'domain': domain,
                'path': sch['relPath'],
                'linked': {'inf': sch_to_inf.get(sch['id'], [])},
            }

    graph_path = os.path.join(WS, '_tmp', 'spec_graph.json')
    os.makedirs(os.path.dirname(graph_path), exist_ok=True)
    with open(graph_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
    print(f'AIDD 참조 인덱스: {graph_path}')


if __name__ == '__main__':
    main()
