# STATUS: 완료
#!/usr/bin/env python3
"""
collect_screen_slice.py — 화면 1개의 소스 슬라이스 수집 (UIS 재설계, 스택중립)

목적: ddd-ui-agent가 "blind glob" 없이 한 화면의 관련 소스만 집중해 읽도록,
진입파일 + 참조자산 + 엔드포인트 후보를 결정적으로 모은다.

**스택중립 규율**: 프레임워크 분기 없음. 두 가지 일반 신호만 쓴다.
  1) stem 매칭 — screenId에서 코드 stem 추출(pr201Form→pr201) 후 동일 basename으로
     시작하는 소스 파일을 확장자 무관 수집 (JSP pr201Form.jsp/.js/pr201t0N.js/Pr201Controller.java,
     Next.js pr201Form.tsx/page.tsx 등 — 컨벤션 기반, 언어 무관).
  2) 참조 따라가기 — 진입파일의 src=/import/require/include basename을 추가 수집.
의미 해석(위젯·동작·api_hints 확정)은 전부 에이전트가 한다 — 여기선 *위치만* 찾는다.

엔드포인트 리터럴(따옴표 안 '/path')은 api_hints(raw)의 씨앗으로 추출(정적 자산 제외).

Usage:
  python collect_screen_slice.py --workspace . --screen-id pr201Form
       [--route /product/prdreg/pr201Form] [--source-roots D:/src,D:/src2]
       [--out _tmp/captures/pr201Form/source_slice.json]
"""
import os, sys, re, json, argparse
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

SRC_EXT = ('.jsp', '.html', '.htm', '.vue', '.tsx', '.jsx', '.ts', '.js',
           '.java', '.kt', '.php', '.erb', '.cshtml', '.svelte')
SKIP_DIR = ('node_modules', '.git', 'dist', 'build', 'target', '.next', 'vendor')
SKIP_FILE = re.compile(r'(\.min\.|jquery|bootstrap|polyfill|chunk\.)', re.I)
# 정적 자산(이미지/스타일/스크립트 리소스 경로)은 엔드포인트가 아님
ASSET_RE = re.compile(r'\.(png|jpe?g|gif|svg|css|js|woff2?|ttf|ico|map)(\?|$)', re.I)
ASSET_PATH = re.compile(r'/(resources|static|assets|theme|img|images|css|js|fonts)/', re.I)
ENDPOINT_RE = re.compile(r"""['"](/[A-Za-z0-9_./\-{}]{3,})['"]""")
REF_RE = re.compile(r"""(?:src|href|file)\s*=\s*['"]([^'"]+)['"]|(?:import[^'"]*from|require)\s*\(?\s*['"]([^'"]+)['"]""")


def source_roots(ws, arg_roots):
    roots = []
    if arg_roots:
        roots = [r.strip() for r in arg_roots.split(',') if r.strip()]
    else:
        env = {}
        p = os.path.join(ws, 'project.env')
        if os.path.exists(p):
            for l in open(p, encoding='utf-8'):
                if '=' in l and not l.startswith('#'):
                    k, v = l.split('=', 1); env[k.strip()] = v.strip()
        for k in ('SOURCE_PATH', 'SOURCE_2_PATH', 'SOURCE_ROOT', 'SOURCE_3_PATH'):
            if env.get(k):
                roots.append(env[k])
        # screen_inventory에서 entryFile 디렉토리 루트 유추
        inv = os.path.join(ws, '_tmp', 'screen_inventory_static.json')
        if not roots and os.path.exists(inv):
            try:
                for it in json.load(open(inv, encoding='utf-8')):
                    ef = it.get('entryFile', '')
                    if ef and os.path.isabs(ef):
                        # src/main 또는 프로젝트 루트로 거슬러 올라감
                        roots.append(ef.split('src')[0] if 'src' in ef else os.path.dirname(ef))
            except Exception:
                pass
    if not roots:
        roots = [ws]
    return [r for r in dict.fromkeys(os.path.abspath(r) for r in roots) if os.path.isdir(r)]


def stems(screen_id):
    """screenId에서 매칭 stem 후보. pr201Form → ['pr201form','pr201']."""
    s = screen_id.strip()
    out = [s.lower()]
    m = re.match(r'^([A-Za-z]+\d+)', s)   # 코드 stem (pr201Form→pr201)
    if m:
        out.append(m.group(1).lower())
    return list(dict.fromkeys(out))


def walk_sources(roots):
    for root in roots:
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in SKIP_DIR]
            for fn in fns:
                if fn.lower().endswith(SRC_EXT) and not SKIP_FILE.search(fn):
                    yield os.path.join(dp, fn), fn


def role_of(path):
    p = path.lower()
    if p.endswith(('.jsp', '.html', '.htm', '.vue', '.erb', '.cshtml', '.svelte', '.php')):
        return 'view'
    if p.endswith(('.tsx', '.jsx')):
        return 'view'           # React/Next: view+behavior 겸용
    if p.endswith(('.java', '.kt')):
        return 'controller'
    if p.endswith(('.js', '.ts')):
        return 'script'
    return 'other'


def extract_endpoints(text):
    out = []
    for m in ENDPOINT_RE.finditer(text):
        p = m.group(1).split('?')[0]
        if ASSET_RE.search(p) or ASSET_PATH.search(p):
            continue
        if len(p) < 4 or p.count('/') < 1:
            continue
        out.append(p)
    return out


def ref_basenames(text):
    bns = set()
    for m in REF_RE.finditer(text):
        ref = m.group(1) or m.group(2) or ''
        bn = os.path.basename(ref.split('?')[0])
        if bn and not SKIP_FILE.search(bn) and '.' in bn:
            bns.add(bn.lower())
    return bns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workspace', default='.')
    ap.add_argument('--screen-id', required=True)
    ap.add_argument('--route', default='')
    ap.add_argument('--source-roots', default='')
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    ws = os.path.abspath(a.workspace)
    roots = source_roots(ws, a.source_roots)
    sid = a.screen_id
    stem_list = stems(sid)
    out_path = a.out or os.path.join(ws, '_tmp', 'captures', sid, 'source_slice.json')

    # 1) stem 매칭으로 후보 파일 수집
    files = {}   # abspath -> {role, basename}
    for full, fn in walk_sources(roots):
        bl = fn.lower()
        base_noext = os.path.splitext(bl)[0]
        if any(base_noext.startswith(st) for st in stem_list):
            files[full] = {'role': role_of(full), 'basename': fn}

    # 2) 진입파일(view) 참조 따라가기 — stem 일치 basename만 추가(공통 taglib 등 노이즈 배제)
    view_paths = [p for p, m in files.items() if m['role'] == 'view']
    wanted_bn = set()
    for vp in view_paths:
        try:
            for bn in ref_basenames(open(vp, encoding='utf-8', errors='ignore').read()):
                base_noext = os.path.splitext(bn)[0]
                if any(base_noext.startswith(st) for st in stem_list):
                    wanted_bn.add(bn)
        except Exception:
            pass
    if wanted_bn:
        for full, fn in walk_sources(roots):
            if full in files:
                continue
            if fn.lower() in wanted_bn:
                files[full] = {'role': role_of(full), 'basename': fn}

    # 3) core / related 분류 — core = 이 화면 본체(view/탭/메인컨트롤러), related = 팝업·서브화면
    sid_l = sid.lower()
    codestem = stem_list[-1]   # pr201 (없으면 sid_l)
    tab_re  = re.compile(rf'^{re.escape(codestem)}t\d+$')              # pr201t01 (탭 조각)
    ctrl_l  = codestem + 'controller'                                  # pr201controller (메인)

    def tier_of(basename):
        b = os.path.splitext(basename)[0].lower()
        if b == sid_l or b.startswith(sid_l):       # pr201Form(.jsp/.js/...)
            return 'core'
        if tab_re.match(b):                          # pr201t01..08 (메인 화면의 탭)
            return 'core'
        if b == ctrl_l:                              # Pr201Controller (메인)
            return 'core'
        return 'related'                             # pr201p02Pop, pr201DlvPop ...

    # 4) 파일별 메타 + 엔드포인트(core만) 추출
    role_order = {'view': 0, 'controller': 1, 'script': 2, 'other': 3}
    core_list, related_list, endpoint_set = [], [], {}
    for full, meta in files.items():
        tier = tier_of(meta['basename'])
        try:
            txt = open(full, encoding='utf-8', errors='ignore').read()
        except Exception:
            txt = ''
        lines = txt.count('\n') + 1
        rel = full
        for r in roots:
            if full.startswith(r):
                rel = os.path.relpath(full, r).replace('\\', '/'); break
        entry = {'path': full.replace('\\', '/'), 'relPath': rel,
                 'role': meta['role'], 'lines': lines}
        if tier == 'core':
            eps = extract_endpoints(txt) if meta['role'] in ('script', 'controller', 'view') else []
            for e in eps:
                endpoint_set[e] = endpoint_set.get(e, 0) + 1
            entry['endpoints'] = sorted(set(eps))
            core_list.append(entry)
        else:
            related_list.append(entry)

    core_list.sort(key=lambda f: (role_order.get(f['role'], 9),
                                  0 if sid_l in f['relPath'].lower() else 1, f['relPath']))
    related_list.sort(key=lambda f: f['relPath'])
    related_list = related_list[:12]   # 팝업·서브화면은 목록만, 상한
    endpoint_candidates = sorted(endpoint_set, key=lambda e: -endpoint_set[e])

    result = {
        'screenId': sid,
        'route': a.route,
        'sourceRoots': roots,
        'coreCount': len(core_list),
        'relatedCount': len(related_list),
        'core': core_list,
        'related': related_list,
        'endpointCandidates': endpoint_candidates,
        'note': '에이전트 입력: core를 Read해 위젯·동작·api_hints 확정. related(팝업/서브화면)는 필요 시만.',
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(result, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    print(f'[slice] screenId={sid}  core={len(core_list)}  related={len(related_list)}  endpoints={len(endpoint_candidates)}')
    for f in core_list:
        print(f"  CORE  {f['role']:10} {f['relPath']}  ({f['lines']} lines, {len(f.get('endpoints',[]))} ep)")
    print(f'  endpoints(core): {endpoint_candidates[:12]}')
    print(f'  → {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
