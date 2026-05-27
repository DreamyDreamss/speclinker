"""
poc_slice.py — POC_SCREENS 기반 화면 슬라이스 필터

지정한 화면(POC_SCREENS=Or701Form,DashboardPage)이 호출하는 API URL을 추출하여
INF/UIS/SCH 생성 범위를 자동 슬라이스한다.

입력:
  project.env: POC_SCREENS=Or701Form,DashboardPage   (쉼표 구분)
  _tmp/screen_inventory.json  (screen_inventory.py가 미리 생성)

출력:
  _tmp/screen_inventory.json  (필터된 — 지정 화면만 남김, .full.json 백업)
  _tmp/poc_target_urls.json   (지정 화면들이 호출하는 API URL 목록)

처리:
  1. screen_inventory.json 로드
  2. POC_SCREENS와 매칭되는 화면만 유지 (entryFile 베이스명, route, screenId 기반)
  3. 매칭된 화면들의 entryFile + componentFiles 읽어 API URL 패턴 추출
  4. 추출한 URL 목록 저장

매칭 패턴 (다중 프레임워크):
  - JSP/jwork:  J.ajax({url:'...'}), $.ajax({url:'...'})
  - React/Vue:  axios.METHOD('...'), fetch('...'), useQuery([_, '...'])
  - 직접 인용:  '/api/...', '/orders/...' 등 명시적 경로
  - Spring MVC: @RequestMapping("/...") + @GetMapping/@PostMapping ("...")

사용:
  python3 poc_slice.py [workspace_root]
"""
import json
import os
import re
import sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass


WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
INV_PATH = os.path.join(WS, '_tmp', 'screen_inventory.json')
URL_OUT = os.path.join(WS, '_tmp', 'poc_target_urls.json')


def load_env():
    p = os.path.join(WS, 'project.env')
    if not os.path.exists(p):
        return {}
    out = {}
    for ln in open(p, encoding='utf-8'):
        ln = ln.strip()
        if not ln or ln.startswith('#') or '=' not in ln:
            continue
        k, v = ln.split('=', 1)
        out[k.strip()] = v.strip()
    return out


# API URL 추출 정규식
URL_PATTERNS = [
    # JSP/jwork
    re.compile(r"""J\.ajax\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]""", re.S),
    re.compile(r"""\$\.ajax\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]""", re.S),
    # axios / fetch
    re.compile(r"""axios\.\w+\s*\(\s*['"]([^'"]+)['"]"""),
    re.compile(r"""axios\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]""", re.S),
    re.compile(r"""fetch\s*\(\s*['"]([^'"]+)['"]"""),
    re.compile(r"""\$fetch\s*\(\s*['"]([^'"]+)['"]"""),
    # SWR / React Query
    re.compile(r"""useQuery\s*\(\s*\[?\s*['"]([^'"]+)['"]"""),
    re.compile(r"""useSWR\s*\(\s*['"]([^'"]+)['"]"""),
    # 명시적 url 변수 (낮은 우선)
    re.compile(r"""url\s*[:=]\s*['"](/[^'"]+)['"]"""),
    # 직접 fetch 패턴 (path만)
    re.compile(r"""['"](/api/[^'"]+)['"]"""),
]


def extract_urls_from_file(path):
    """파일 1개에서 API URL 목록 추출"""
    if not path or not os.path.exists(path):
        return []
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return []

    urls = set()
    for pat in URL_PATTERNS:
        for m in pat.finditer(body):
            url = m.group(1).strip()
            # 정리: 쿼리스트링·플레이스홀더 정규화
            url = re.sub(r'\?.*$', '', url)
            url = re.sub(r'\$\{[^}]+\}', ':id', url)        # ${var} → :id
            url = re.sub(r'<%=[^%]+%>', ':id', url)         # <%= var %> → :id
            if url and url.startswith('/') and len(url) > 1:
                urls.add(url)
    return sorted(urls)


def match_screen(screen, poc_targets):
    """화면이 POC_SCREENS 타깃과 매칭되는지"""
    entry = screen.get('entryFile', '') or ''
    route = screen.get('route', '') or ''
    base = os.path.splitext(os.path.basename(entry))[0]

    candidates = {
        base.lower(),
        base.lower().replace('_', '').replace('-', ''),
        route.lower().lstrip('/'),
    }
    # 마지막 경로 세그먼트
    if route:
        last_seg = route.rstrip('/').split('/')[-1]
        candidates.add(last_seg.lower())

    for t in poc_targets:
        tl = t.lower()
        if tl in candidates:
            return True
        # 부분 매칭 (예: Or701 → Or701Form 도 매칭)
        for c in candidates:
            if c and (c.startswith(tl) or tl.startswith(c)):
                return True
    return False


def main():
    env = load_env()
    if env.get('POC_MODE', 'false').lower() != 'true':
        print('POC_MODE=false — slice 적용 안 함')
        return

    poc_screens = [s.strip() for s in env.get('POC_SCREENS', '').split(',') if s.strip()]
    if not poc_screens:
        print('POC_SCREENS 비어있음 — slice 적용 안 함')
        return

    if not os.path.exists(INV_PATH):
        print(f'[ERROR] {INV_PATH} 없음 — screen_inventory.py 먼저 실행 필요', file=sys.stderr)
        sys.exit(1)

    inventory = json.load(open(INV_PATH, encoding='utf-8'))
    full_count = len(inventory)

    # 백업 (한 번만)
    backup = INV_PATH + '.full.json'
    if not os.path.exists(backup):
        with open(backup, 'w', encoding='utf-8') as f:
            json.dump(inventory, f, ensure_ascii=False, indent=2)
        print(f'백업: {backup}')

    # 필터링
    kept = [s for s in inventory if match_screen(s, poc_screens)]
    if not kept:
        print(f'⚠️  POC_SCREENS={poc_screens} 와 매칭되는 화면 없음 — slice 건너뜀')
        return

    # URL 추출
    all_urls = set()
    per_screen = {}
    for s in kept:
        urls = set()
        for f in [s.get('entryFile')] + (s.get('componentFiles') or []):
            urls.update(extract_urls_from_file(f))
        per_screen[s.get('entryFile') or s.get('route')] = sorted(urls)
        all_urls.update(urls)

    # 필터된 인벤토리 저장
    with open(INV_PATH, 'w', encoding='utf-8') as f:
        json.dump(kept, f, ensure_ascii=False, indent=2)

    # URL 출력
    out = {
        'pocScreens':   poc_screens,
        'keptScreens':  len(kept),
        'fullScreens':  full_count,
        'targetUrls':   sorted(all_urls),
        'perScreen':    per_screen,
    }
    with open(URL_OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print('=' * 60)
    print(f'🧪 POC slice 적용')
    print(f'  POC_SCREENS:   {poc_screens}')
    print(f'  매칭 화면:     {len(kept)}/{full_count}건')
    for s in kept:
        print(f'    - {s.get("entryFile","?")} ({s.get("route","?")})')
    print(f'  추출 URL:      {len(all_urls)}건')
    for u in sorted(all_urls)[:15]:
        print(f'    - {u}')
    if len(all_urls) > 15:
        print(f'    ... 외 {len(all_urls)-15}건')
    print(f'\n  저장: {INV_PATH} (필터됨), {URL_OUT}')
    print(f'  복원: cp {backup} {INV_PATH}')


if __name__ == '__main__':
    main()
