#!/usr/bin/env python3
"""
gen_docsify.py — speclinker 산출물 스캔 → spec_index.json 생성

Usage:
    python gen_docsify.py [spec_root]
    spec_root: project.env가 있는 프로젝트 루트. 기본값: 현재 디렉터리
"""
import os
import re
import json
import sys
import shutil
from datetime import datetime


def _get_fm_block(content: str) -> str:
    """--- ... --- frontmatter 블록 문자열 반환. 없으면 빈 문자열."""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    return m.group(1) if m else ''


def parse_frontmatter(content: str) -> dict:
    """마크다운 YAML frontmatter를 {key: value} dict로 파싱."""
    fm = {}
    for line in _get_fm_block(content).splitlines():
        if ':' in line and not line.startswith(' ') and not line.startswith('-'):
            k, _, v = line.partition(':')
            k, v = k.strip(), v.strip()
            if k:
                fm[k] = v
    return fm


def _extract_list_field(fm_block: str, key: str) -> list:
    """frontmatter 블록에서 YAML 리스트 필드 추출."""
    result, in_list = [], False
    for line in fm_block.splitlines():
        if re.match(rf'^{re.escape(key)}:\s*$', line.rstrip()):
            in_list = True
            continue
        if in_list:
            stripped = line.strip()
            if stripped.startswith('- '):
                val = stripped[2:].split('#')[0].strip()
                if val:
                    result.append(val)
            elif stripped and not line.startswith(' '):
                break
    return result


def count_tbd(content: str) -> int:
    """frontmatter 이후 본문의 [TBD] 개수 반환."""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    fm_block = _get_fm_block(content)
    if fm_block:
        # frontmatter delimiter + block + delimiter length
        body = content[len('---\n') + len(fm_block) + len('\n---'):]
    else:
        body = content
    return len(re.findall(r'\[TBD\]', body))


def _iter_inf_dirs(spec_root: str):
    """INF 파일 디렉터리 iterator. 두 가지 구조 모두 지원:
    A) docs/05_설계서/INF/{domain}/  (신규 표준)
    B) docs/05_설계서/{domain}/INF/  (기존 프로젝트)
    yields (domain_name, dir_path)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    # 구조 A: INF/{domain}/
    inf_root_a = os.path.join(design_root, 'INF')
    if os.path.isdir(inf_root_a):
        for d in sorted(os.listdir(inf_root_a)):
            p = os.path.join(inf_root_a, d)
            if os.path.isdir(p):
                yield d, p
        return
    # 구조 B: {domain}/INF/
    for domain in sorted(os.listdir(design_root)):
        inf_sub = os.path.join(design_root, domain, 'INF')
        if os.path.isdir(inf_sub):
            yield domain, inf_sub


def scan_infs(spec_root: str) -> list:
    """docs/05_설계서 하위 INF-*.md 전수 스캔 (두 가지 폴더 구조 지원)."""
    infs = []
    for domain_dir, domain_path in _iter_inf_dirs(spec_root):
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('INF-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                with open(fpath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            # 기능명(한글 설명): H1 제목 `# INF-...: METHOD path — {기능명}` 의 '—'(또는 ' - ') 뒤
            name = ''
            m_h1 = re.search(r'^#\s*INF-\S+\s*:\s*(.+)$', content, re.M)
            if m_h1:
                title = m_h1.group(1).strip()
                for sep in ('—', '–', ' - '):
                    if sep in title:
                        name = title.split(sep, 1)[1].strip()
                        break
            # 앵커(JIT 준비) 수 — frontmatter anchors[] 길이
            anchor_count = len(_extract_list_field(_get_fm_block(content), 'anchors'))
            infs.append({
                'id': fm.get('inf-id', fname.replace('.md', '')),
                'name': name,
                'method': fm.get('method', ''),
                'path': fm.get('path', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'tbd_count': count_tbd(content),
                'anchor_count': anchor_count,
                'tables': _extract_list_field(_get_fm_block(content), 'tables'),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return infs


def _iter_uis_dirs(spec_root: str):
    """UIS 화면 디렉토리 iterator. 두 구조 지원:
    A) docs/05_설계서/{domain}/UIS/{screen}/spec.md  (도메인별 — 현행 권장)
    B) docs/05_설계서/UIS/{screen}/spec.md           (top-level — 구버전 호환)
    yields screen_dir_path (spec.md를 담은 디렉토리)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    # A) 도메인별
    for domain in sorted(os.listdir(design_root)):
        uis_sub = os.path.join(design_root, domain, 'UIS')
        if os.path.isdir(uis_sub):
            for entry in sorted(os.listdir(uis_sub)):
                d = os.path.join(uis_sub, entry)
                if os.path.isfile(os.path.join(d, 'spec.md')):
                    yield d
    # B) top-level (구버전)
    uis_root = os.path.join(design_root, 'UIS')
    if os.path.isdir(uis_root):
        for entry in sorted(os.listdir(uis_root)):
            d = os.path.join(uis_root, entry)
            if os.path.isfile(os.path.join(d, 'spec.md')):
                yield d


def scan_uis(spec_root: str) -> list:
    """UIS spec.md 전수 스캔 (도메인별 {domain}/UIS/{screen}/ 우선, top-level 호환)."""
    uis = []
    for screen_dir in _iter_uis_dirs(spec_root):
        spec_path = os.path.join(screen_dir, 'spec.md')
        entry = os.path.basename(screen_dir)
        try:
            with open(spec_path, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        fm = parse_frontmatter(content)
        fb = _get_fm_block(content)
        # 미리보기: preview_annotated.png(마커) 우선, 없으면 preview.png
        prev = None
        for cand in ('preview_annotated.png', 'preview.png'):
            if os.path.isfile(os.path.join(screen_dir, cand)):
                prev = cand
                break
        uis.append({
            'id': fm.get('UIS-ID', entry),
            'name': fm.get('화면명', ''),
            'route': fm.get('라우트', ''),
            'domain': fm.get('도메인', ''),
            'menu_path': _extract_list_field(fb, 'menu-path'),
            'apis': _extract_list_field(fb, 'apis') or _extract_list_field(fb, 'api_hints'),
            'has_preview': prev is not None,
            'preview': prev or 'preview.png',
            'anchor_count': len(_extract_list_field(fb, 'anchors')),
            'file': os.path.relpath(spec_path, spec_root).replace('\\', '/'),
        })
    return uis


def _iter_sch_dirs(spec_root: str):
    """SCH 파일 디렉터리 iterator. 두 구조 지원:
    A) docs/05_설계서/SCH/{domain}/   B) docs/05_설계서/{domain}/SCH/
    yields (domain_name, dir_path)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    sch_root_a = os.path.join(design_root, 'SCH')
    if os.path.isdir(sch_root_a):
        for d in sorted(os.listdir(sch_root_a)):
            p = os.path.join(sch_root_a, d)
            if os.path.isdir(p):
                yield d, p
        return
    for domain in sorted(os.listdir(design_root)):
        sch_sub = os.path.join(design_root, domain, 'SCH')
        if os.path.isdir(sch_sub):
            yield domain, sch_sub


def _parse_inf_list(fm_block: str, fm: dict) -> list:
    """SCH frontmatter의 inf: 값을 리스트로. 인라인([a, b])·블록(- a) 모두 지원."""
    raw = fm.get('inf', '').strip()
    if raw.startswith('[') and raw.endswith(']'):
        return [x.strip() for x in raw[1:-1].split(',') if x.strip()]
    block = _extract_list_field(fm_block, 'inf')
    if block:
        return block
    return [x.strip() for x in raw.split(',') if x.strip()] if raw else []


def scan_schs(spec_root: str) -> list:
    """docs/05_설계서 하위 SCH-*.md 전수 스캔 (두 구조 지원)."""
    schs = []
    for domain_dir, domain_path in _iter_sch_dirs(spec_root):
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('SCH-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                with open(fpath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            fb = _get_fm_block(content)
            schs.append({
                'id': fm.get('sch-id', fname.replace('.md', '')),
                'table': fm.get('table', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'inf': _parse_inf_list(fb, fm),
                'anchor_count': len(_extract_list_field(fb, 'anchors')),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return schs


def load_sprint_status(spec_root: str) -> dict:
    """sprint-status.yaml에서 도메인별 done/total 집계."""
    path = os.path.join(spec_root, '.speclinker', 'sprint-status.yaml')
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            content = f.read()
    except OSError:
        return {}
    stats, current = {}, None
    for line in content.splitlines():
        m = re.match(r'^([a-zA-Z][a-zA-Z0-9_-]*):\s*$', line)
        if m:
            current = m.group(1)
            stats.setdefault(current, {'done': 0, 'total': 0})
        sm = re.search(r'\bstatus:\s*(done|review|in-progress|backlog|ready(?:-for-dev)?)\b', line)
        if sm and current:
            stats[current]['total'] += 1
            if sm.group(1) == 'done':
                stats[current]['done'] += 1
    return stats


def build_ia_tree(uis: list) -> dict:
    """menu_path 기반 IA 트리 생성."""
    tree: dict = {}
    for ui in uis:
        path = [p for p in ui.get('menu_path', []) if p and p != '[TBD]']
        domain = ui.get('domain', 'unknown')
        screen = {'id': ui['id'], 'name': ui['name'], 'apis': ui.get('apis', [])}
        if not path:
            tree.setdefault(f'[{domain}]', {}).setdefault('__screens__', []).append(screen)
            continue
        node = tree
        for i, segment in enumerate(path):
            if i == len(path) - 1:
                node.setdefault(segment, {}).setdefault('__screens__', []).append(screen)
            else:
                node = node.setdefault(segment, {})
    return tree


def _norm_path(p: str) -> str:
    """쿼리/프래그먼트 제거 + 끝 슬래시 정리."""
    p = (p or '').split('?')[0].split('#')[0].strip()
    if len(p) > 1 and p.endswith('/'):
        p = p[:-1]
    return p


_INF_ID_RE = re.compile(r'INF-[A-Z]+-\d+')


def resolve_uis_inf(uis: list, infs: list) -> None:
    """각 UIS의 api_hints/apis를 INF id로 해소 → uis[i]['inf_ids']. in-place 보강.

    실제 api_hints 항목 형식(권위: link_uis_inf.py 산출):
      - "POST [INF-PRD-490](../../INF/INF-PRD-490.md)"  (이미 ID 해소됨 — 1차)
      - "POST /app/product/prdreg/save"                 (미해소 raw — 2차 path 매칭)
      - 따옴표 래핑/메서드 접두 가능
    해소 순서: ① 항목에 박힌 INF-ID 직접 추출 ② METHOD 토큰 제거 후 경로 추출 →
    INF path 정확매칭 → 컨텍스트 접두(/app 등) 차이 보정 위해 suffix 매칭. 실패분은 무시."""
    by_path = {}
    for inf in infs:
        np = _norm_path(inf.get('path', ''))
        if np:
            by_path.setdefault(np, inf['id'])
    valid_ids = {inf['id'] for inf in infs}
    for u in uis:
        ids = []
        for a in (u.get('apis') or []):
            s = str(a).strip().strip('"\'').strip()
            hit = None
            # ① 이미 INF-ID가 박힌 경우 직접 추출
            m = _INF_ID_RE.search(s)
            if m and m.group(0) in valid_ids:
                hit = m.group(0)
            else:
                # ② "METHOD path" → '/'로 시작하는 첫 토큰을 경로로
                path_tok = next((p for p in s.split() if p.startswith('/')), None)
                na = _norm_path(path_tok) if path_tok else ''
                if na:
                    if na in by_path:
                        hit = by_path[na]
                    elif len(na) > 1:
                        # 컨텍스트 접두 차이(/app/x vs /x): 한쪽이 다른쪽 경로꼬리이면 매칭
                        for np, iid in by_path.items():
                            if np == na or np.endswith(na) or na.endswith(np):
                                hit = iid
                                break
            if hit and hit not in ids:
                ids.append(hit)
        u['inf_ids'] = ids


def build_inf_sch_index(infs: list, schs: list) -> None:
    """INF↔SCH 연결 → infs[i]['sch_ids']. in-place 보강.
    두 방향 합집합: ① SCH frontmatter inf[] 역참조 ② INF frontmatter tables[] → SCH.table 정방향 매칭
    (SCH.inf 목록이 희소해 ②가 없으면 연결이 멀쩡해도 대거 '미연결'로 잡힘)."""
    rev = {}
    for s in schs:
        for iid in (s.get('inf') or []):
            rev.setdefault(iid, []).append(s['id'])
    # 테이블명(대문자) → SCH-ID 목록
    by_table = {}
    for s in schs:
        t = (s.get('table') or '').strip().upper()
        if t:
            by_table.setdefault(t, []).append(s['id'])
    for inf in infs:
        ids = list(rev.get(inf['id'], []))
        for t in (inf.get('tables') or []):
            for sid in by_table.get(str(t).strip().upper(), []):
                if sid not in ids:
                    ids.append(sid)
        inf['sch_ids'] = ids


def load_func_links(spec_root: str, infs: list, uis: list, schs: list) -> None:
    """FUNC_MAP.md에서 산출물ID→FUNC-ID 역매핑 → 각 항목 ['func'] 보강.
    파일/매핑 없으면 'func' 미설정(graceful)."""
    fp = os.path.join(spec_root, 'docs', '00_FUNC', 'FUNC_MAP.md')
    if not os.path.exists(fp):
        return
    with open(fp, encoding='utf-8') as f:
        text = f.read()
    mapping = {}  # 산출물ID -> FUNC-ID
    func_re = re.compile(r'FUNC-[a-zA-Z]+-\d+')
    art_re = re.compile(r'(?:INF|UIS|SCH|BAT)-[A-Za-z]+-\d+')
    for line in text.splitlines():
        funcs = func_re.findall(line)
        if not funcs:
            continue
        fid = funcs[0]
        for art in art_re.findall(line):
            mapping.setdefault(art, fid)
    for coll in (infs, uis, schs):
        for item in coll:
            if item['id'] in mapping:
                item['func'] = mapping[item['id']]


def scan_funcs(spec_root: str) -> list:
    """FUNC_MAP.md 파싱 → funcs[] 목록. 각 표 행에서 FUNC/UIS/INF/SCH ID를
    정규식으로 수집(컬럼 순서 비의존). 파일 없으면 [] (graceful)."""
    fp = os.path.join(spec_root, 'docs', '00_FUNC', 'FUNC_MAP.md')
    if not os.path.exists(fp):
        return []
    with open(fp, encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()
    func_re = re.compile(r'FUNC-[A-Za-z]+-\d+')
    uis_re = re.compile(r'UIS-[A-Za-z]+-\d+(?:-T\d+)?')
    inf_re = re.compile(r'INF-[A-Za-z]+-\d+')
    sch_re = re.compile(r'SCH-[A-Za-z]+-\d+')
    funcs, seen = [], set()
    for line in lines:
        fids = func_re.findall(line)
        if not fids:
            continue
        fid = fids[0]
        if fid in seen:   # 색인 표 행이 먼저 → 이후 갭/요약 표의 중복 FUNC 행 무시
            continue
        seen.add(fid)
        parts = fid.split('-')
        domain = parts[1] if len(parts) >= 3 else ''
        name = ''
        for c in (x.strip() for x in line.split('|')):
            if c and '---' not in c and not (func_re.search(c) or uis_re.search(c)
                                             or inf_re.search(c) or sch_re.search(c)):
                name = c
                break
        funcs.append({
            'id': fid,
            'name': name,
            'domain': domain,
            'file': 'docs/00_FUNC/FUNC_MAP.md',
            'uis': sorted(set(uis_re.findall(line))),
            'inf': sorted(set(inf_re.findall(line))),
            'sch': sorted(set(sch_re.findall(line))),
        })
    return funcs


def scan_srs(spec_root: str) -> list:
    """SRS_v1.0.md 색인표 파싱 → srs[] (id/name/uis/inf/func/domain/file). 없으면 [] (graceful)."""
    fp = os.path.join(spec_root, 'docs', '03_기능명세서', 'SRS_v1.0.md')
    if not os.path.exists(fp):
        return []
    with open(fp, encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()
    srs_re = re.compile(r'SRS-F-\d+')
    uis_re = re.compile(r'UIS-[A-Za-z]+-\d+(?:-T\d+)?')
    inf_re = re.compile(r'INF-[A-Za-z]+-\d+')
    func_re = re.compile(r'FUNC-[A-Za-z]+-\d+')
    out = []
    for line in lines:
        sids = srs_re.findall(line)
        if not sids:
            continue
        funcs = func_re.findall(line)
        domain = funcs[0].split('-')[1] if funcs and len(funcs[0].split('-')) >= 3 else ''
        name = ''
        for c in (x.strip() for x in line.split('|')):
            if c and '---' not in c and not (srs_re.search(c) or uis_re.search(c)
                                             or inf_re.search(c) or func_re.search(c)):
                name = c
                break
        # 실제 SRS-F 본문은 도메인 상세파일(domains/SRS_{도메인}.md)에 있다.
        # 인덱스(SRS_v1.0.md)가 아니라 상세파일을 가리켜야 클릭 시 그 SRS 내용이 뜬다.
        detail_rel = f'docs/03_기능명세서/domains/SRS_{domain}.md'
        file_rel = (detail_rel if domain and os.path.isfile(os.path.join(spec_root, detail_rel))
                    else 'docs/03_기능명세서/SRS_v1.0.md')
        out.append({
            'id': sids[0], 'name': name, 'domain': domain,
            'file': file_rel,
            'uis': sorted(set(uis_re.findall(line))),
            'inf': sorted(set(inf_re.findall(line))),
            'func': funcs[0] if funcs else '',
        })
    return out


def compute_gaps(infs: list, uis: list) -> dict:
    """연결 끊긴 산출물 집계(품질 가시화)."""
    return {
        'inf_no_sch': sum(1 for i in infs if not i.get('sch_ids')),
        'uis_no_inf': sum(1 for u in uis if not u.get('inf_ids')),
    }


def _load_json(path: str):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def build_manifest(spec_root: str) -> dict:
    """도메인별 '생성되어야 할' 스펙 목록(expected) 스냅샷을 .speclinker/spec_manifest.json에
    영속화한다. _tmp 산출물은 휘발성이므로, 신선한 소스가 있을 때만 해당 섹션을 갱신하고
    없으면 직전 매니페스트를 보존한다(carry-forward).

    스냅샷 대상:
      inf — _tmp/router_inventory_with_chain.json (apiRoutes로 INF-ID 결정론적 재구성)
      uis — .speclinker/screen_plan.confirmed.json → _tmp/screen_plan_static.json
    SCH는 생성된 INF의 tables에서 매 실행 라이브 도출하므로 매니페스트에 저장하지 않는다.
    """
    mpath = os.path.join(spec_root, '.speclinker', 'spec_manifest.json')
    manifest = _load_json(mpath) or {}

    # ── INF expected ── router 인벤토리(있을 때만 갱신)
    inv = _load_json(os.path.join(spec_root, '_tmp', 'router_inventory_with_chain.json'))
    if isinstance(inv, list):
        inf_items = []
        for group in inv:
            if not isinstance(group, list):
                continue
            for item in group:
                if not isinstance(item, dict):
                    continue
                domain = item.get('domain', '')
                dcode = item.get('domainCode', '')
                start = item.get('infIdStart')
                routes = item.get('apiRoutes') or []
                fp = item.get('filePath', '')
                base = os.path.basename(str(fp))
                if not (dcode and isinstance(start, int)):
                    continue
                if routes:
                    for j, r in enumerate(routes):
                        if isinstance(r, dict):
                            m = r.get('method') or r.get('httpMethod') or ''
                            p = r.get('path') or r.get('url') or r.get('uri') or ''
                            label = (str(m).upper() + ' ' + str(p)).strip() or base
                        else:
                            label = str(r)
                        inf_items.append({'id': f'INF-{dcode}-{start + j:03d}',
                                          'label': label, 'domain': domain})
                else:
                    inf_items.append({'id': f'INF-{dcode}-{start:03d}',
                                      'label': base, 'domain': domain})
        if inf_items:
            manifest['inf'] = inf_items

    # ── UIS expected ── screen_plan(confirmed 우선, static 폴백; 있을 때만 갱신)
    plan = (_load_json(os.path.join(spec_root, '.speclinker', 'screen_plan.confirmed.json'))
            or _load_json(os.path.join(spec_root, '_tmp', 'screen_plan_static.json')))
    if isinstance(plan, dict) and isinstance(plan.get('screens'), list):
        uis_items = []
        for s in plan['screens']:
            if not isinstance(s, dict):
                continue
            if str(s.get('status', '')).lower() == 'excluded':
                continue
            sid = s.get('id') or ''
            if not sid:
                continue
            route = s.get('route') or ''
            name = s.get('name') or ''
            label = (name + (f' ({route})' if route else '')).strip() or sid
            uis_items.append({'id': sid, 'label': label, 'domain': s.get('domain', '')})
        if uis_items:
            manifest['uis'] = uis_items

    manifest['generated_at'] = datetime.now().isoformat(timespec='seconds')
    try:
        os.makedirs(os.path.dirname(mpath), exist_ok=True)
        with open(mpath, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return manifest


def build_coverage(spec_root: str, domains: dict, infs: list, schs: list, uis: list, srs: list = None) -> None:
    """expected(매니페스트+INF tables) vs generated(.md) 대조 → domains[d]['coverage'] 채움.
    coverage[kind] = {expected, generated, missing:[{id,label}]}. 미생성 항목만 missing에 담는다
    (생성분은 infs/uis/schs 배열에서 렌더). 소스 없으면 해당 kind 생략(graceful)."""
    manifest = build_manifest(spec_root)

    def ensure(d):
        domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})

    # 테이블 레지스트리 갱신·영속(매 인덱스 빌드 시 — 뷰어 신선도) — 순환 import 회피 위해 지연 import
    registry = None
    try:
        import build_table_registry as BTR
        registry = BTR.write_registry(spec_root)
    except Exception:
        registry = None

    # ── INF ──
    gen_inf = {i['id'] for i in infs}
    inf_exp = manifest.get('inf') or []
    if inf_exp:
        per = {}
        for it in inf_exp:
            per.setdefault(it.get('domain', ''), []).append(it)
        for d, items in per.items():
            if not d:
                continue
            ensure(d)
            missing = [{'id': it['id'], 'label': it.get('label', it['id'])}
                       for it in items if it['id'] not in gen_inf]
            domains[d].setdefault('coverage', {})['inf'] = {
                'expected': len(items), 'generated': len(items) - len(missing), 'missing': missing}

    # ── SCH ── 추출대상 테이블 레지스트리(INF∪SQL∪UIS) vs 생성된 SCH
    if registry and registry.get('tables'):
        per = {}
        for t in registry['tables']:
            per.setdefault(t.get('domain', ''), []).append(t)
        for d, tbls in per.items():
            if not d:
                continue
            ensure(d)
            missing = [{'id': t['table'], 'label': t['table'],
                        'sources': t.get('sources', []),
                        'screens': t.get('used_by_screens', [])}
                       for t in tbls if not t.get('generated')]
            domains[d].setdefault('coverage', {})['sch'] = {
                'expected': len(tbls), 'generated': len(tbls) - len(missing), 'missing': missing}
    else:
        # 폴백: 레지스트리 없으면 INF tables 합집합에서 도출(구 동작)
        exp_tbl = {}
        for i in infs:
            d = i.get('domain', '')
            for t in (i.get('tables') or []):
                tu = str(t).strip().upper()
                if tu:
                    exp_tbl.setdefault(d, {})[tu] = str(t).strip()
        gen_tbl = {}
        for s in schs:
            d = s.get('domain', '')
            tu = str(s.get('table', '')).strip().upper()
            if tu:
                gen_tbl.setdefault(d, set()).add(tu)
        for d, tbls in exp_tbl.items():
            if not d:
                continue
            ensure(d)
            have = gen_tbl.get(d, set())
            missing = [{'id': orig, 'label': orig} for tu, orig in sorted(tbls.items()) if tu not in have]
            domains[d].setdefault('coverage', {})['sch'] = {
                'expected': len(tbls), 'generated': len(tbls) - len(missing), 'missing': missing}

    # ── UIS ──
    gen_uis = {ui['id'] for ui in (uis or [])}
    uis_exp = manifest.get('uis') or []
    if uis_exp:
        per = {}
        for it in uis_exp:
            per.setdefault(it.get('domain', ''), []).append(it)
        for d, items in per.items():
            if not d:
                continue
            ensure(d)
            missing = [{'id': it['id'], 'label': it.get('label', it['id'])}
                       for it in items if it['id'] not in gen_uis]
            domains[d].setdefault('coverage', {})['uis'] = {
                'expected': len(items), 'generated': len(items) - len(missing), 'missing': missing}

    # ── SRS ── 화면 1:1 원칙: 생성된 화면(UIS)마다 SRS-F가 있어야 함
    srs = srs or []
    covered_uis = set()       # SRS가 다루는 UIS-ID
    for s in srs:
        for u in (s.get('uis') or []):
            covered_uis.add(u)
    uis_by_dom = {}
    for ui in (uis or []):
        d = ui.get('domain', '')
        if d:
            uis_by_dom.setdefault(d, []).append(ui)
    for d, items in uis_by_dom.items():
        ensure(d)
        missing = [{'id': ui['id'], 'label': (ui.get('name') or ui['id'])}
                   for ui in items if ui['id'] not in covered_uis]
        domains[d].setdefault('coverage', {})['srs'] = {
            'expected': len(items), 'generated': len(items) - len(missing), 'missing': missing}


def generate_index(spec_root: str, output_path: str) -> dict:
    """전체 스캔 실행 → spec_index.json 저장 → index dict 반환."""
    infs = scan_infs(spec_root)
    uis = scan_uis(spec_root)
    schs = scan_schs(spec_root)
    sprint = load_sprint_status(spec_root)

    # ── 관계 데이터 보강 (SpecLens 재설계) ──
    resolve_uis_inf(uis, infs)
    build_inf_sch_index(infs, schs)
    load_func_links(spec_root, infs, uis, schs)
    gaps = compute_gaps(infs, uis)

    domains: dict = {}
    for inf in infs:
        d = inf['domain']
        domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
        domains[d]['inf'] += 1
        domains[d]['tbd_total'] += inf['tbd_count']
    for ui in uis:
        d = ui.get('domain', '')
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['uis'] += 1
    for sch in schs:
        d = sch['domain']
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['sch'] += 1
    for d, s in sprint.items():
        if d in domains:
            domains[d]['sprint_done'] = s['done']
            domains[d]['sprint_total'] = s['total']
    # 도메인별 OVERVIEW 경로 (있으면)
    for d in domains:
        ov = os.path.join('docs', '05_설계서', d, f'OVERVIEW_{d}.md')
        if os.path.isfile(os.path.join(spec_root, ov)):
            domains[d]['overview'] = ov.replace('\\', '/')

    funcs = scan_funcs(spec_root)
    srs = scan_srs(spec_root)
    for s in srs:
        d = s.get('domain')
        if d and d in domains:
            domains[d]['srs_count'] = domains[d].get('srs_count', 0) + 1

    # 생성/미생성 커버리지 (expected vs generated) — domains[d]['coverage'] 채움
    build_coverage(spec_root, domains, infs, schs, uis, srs)

    index = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'totals': {'inf': len(infs), 'uis': len(uis), 'sch': len(schs), 'bat': 0},
        'domains': domains,
        'infs': infs,
        'uis': uis,
        'schs': schs,
        'funcs': funcs,
        'srs': srs,
        'gaps': gaps,
        'ia_tree': build_ia_tree(uis),
    }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f'[OK] spec_index.json 생성 완료')
    print(f'     INF {len(infs)}개 | UIS {len(uis)}개 | SCH {len(schs)}개 | 도메인 {len(domains)}개')
    print(f'     → {output_path}')
    return index


def copy_viewer_assets(spec_root: str) -> None:
    """플러그인 뷰어 자산(index.html/js/css)을 프로젝트 docs/viewer/로 복사.

    뷰어는 프로젝트 루트에서 서빙된다(문서 docs/...와 자산 docs/viewer/...이
    한 서버 루트 아래 있어야 INF 클릭 라우팅이 동작). 따라서 깨끗한 프로젝트에도
    부트스트랩 자산이 docs/viewer/ 안에 존재하도록 매 실행마다 동기화한다."""
    plugin_viewer = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'viewer'))
    dest = os.path.join(spec_root, 'docs', 'viewer')
    os.makedirs(dest, exist_ok=True)
    copied = []
    for asset in ('index.html', 'docsify-sl.js', 'sl-theme.css'):
        src = os.path.join(plugin_viewer, asset)
        dst = os.path.join(dest, asset)
        if not os.path.isfile(src):
            continue
        if os.path.abspath(src) == os.path.abspath(dst):
            continue  # 플러그인 자체를 대상으로 실행한 경우 자기복사 방지
        try:
            shutil.copy2(src, dst)
            copied.append(asset)
        except OSError:
            pass
    if copied:
        print(f'[OK] 뷰어 자산 동기화: {", ".join(copied)} → {dest}')


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    copy_viewer_assets(root)
    out = os.path.join(root, 'docs', 'viewer', 'spec_index.json')
    generate_index(root, out)
