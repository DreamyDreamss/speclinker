# STATUS: 완료
"""
link_uis_inf.py — INF 생성 완료 후 UIS spec.md §5의 URL을 INF 링크로 교체

UIS 작성 시점에 INF가 없어서 URL만 적혀있던 §5 셀을
ddd-api-agent가 INF를 생성한 뒤 이 스크립트로 일괄 링크화.

LLM 재호출 없이 스크립트로 처리 — 토큰 절약.

입력:
  - _tmp/{화면ID}_inf_required.json  (ddd-ui-agent가 출력)
  - docs/05_설계서/{domain}/INF/INF-*.md (생성된 INF 파일들)
  - docs/05_설계서/{domain}/UI/{화면ID}/spec.md (패치 대상)

출력:
  - spec.md §5 내 URL → [INF-NNN](../../INF/INF-NNN.md) 교체
  - _tmp/{화면ID}_inf_required.json 의 매칭된 항목 제거 (남은 것 = 아직 INF 없음)

사용:
  python3 link_uis_inf.py [workspace]
  python3 link_uis_inf.py [workspace] --screen-id=Pr201Form
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
SCREEN_FILTER = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--screen-id=')), None)


def build_inf_index(workspace):
    """모든 도메인의 INF-*.md 스캔 → {path_lower: (inf_id, method, rel_path)} 인덱스."""
    idx = {}
    design_root = os.path.join(workspace, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return idx
    for domain in os.listdir(design_root):
        inf_dir = os.path.join(design_root, domain, 'INF')
        if not os.path.isdir(inf_dir):
            continue
        for fname in os.listdir(inf_dir):
            if not (fname.startswith('INF-') and fname.endswith('.md')):
                continue
            fpath = os.path.join(inf_dir, fname)
            try:
                body = open(fpath, encoding='utf-8').read()
            except Exception:
                continue
            m_id  = re.search(r'^inf-id:\s*(\S+)', body, re.M | re.I)
            m_mtd = re.search(r'^method:\s*(\S+)', body, re.M | re.I)
            m_pth = re.search(r'^path:\s*(\S+)',   body, re.M | re.I)
            if not (m_id and m_pth):
                continue
            inf_id = m_id.group(1)
            method = (m_mtd.group(1) if m_mtd else '*').upper()
            path   = m_pth.group(1).lower()
            idx[path] = (inf_id, method, domain)
            # method-agnostic fallback
            idx[('*', path)] = (inf_id, method, domain)
    return idx


def find_inf(url, method, inf_idx):
    """URL + method → INF-ID 매칭. 부분 prefix 허용."""
    u = url.lower()
    m = (method or '').upper()
    # 정확 매칭
    if (m, u) in inf_idx:
        return inf_idx[(m, u)]
    if u in inf_idx:
        return inf_idx[u]
    # prefix 매칭
    for key, val in inf_idx.items():
        k = key[1] if isinstance(key, tuple) else key
        if isinstance(k, str) and len(k) > 4 and (k == u or u.startswith(k) or k.startswith(u)):
            return val
    return None


def patch_spec(spec_path, url_to_inf):
    """spec.md §5 내의 URL 백틱 표기를 INF 링크로 교체.
    패턴: `url` 또는 url (§5 표의 API 호출 셀)
    """
    try:
        body = open(spec_path, encoding='utf-8').read()
    except Exception as e:
        return 0, str(e)

    patched = 0
    for url, (inf_id, domain) in url_to_inf.items():
        # 상대 경로 계산: spec.md → ../../INF/INF-NNN.md
        inf_link = f'[{inf_id}](../../INF/{inf_id}.md)'
        # 백틱 URL 패턴
        before = body
        body = re.sub(r'`' + re.escape(url) + r'`', inf_link, body, flags=re.I)
        # 공백 URL 패턴 (표 셀 안)
        body = re.sub(r'(?<!\[)' + re.escape(url) + r'(?!\])', inf_link, body, flags=re.I)
        if body != before:
            patched += 1

    if patched > 0:
        with open(spec_path, 'w', encoding='utf-8') as f:
            f.write(body)
    return patched, ''


def process_screen(workspace, screen_id, inf_idx):
    """_tmp/{screen_id}_inf_required.json 읽어서 매칭 후 spec.md 패치."""
    req_path = os.path.join(workspace, '_tmp', f'{screen_id}_inf_required.json')
    if not os.path.exists(req_path):
        return

    try:
        req = json.load(open(req_path, encoding='utf-8'))
    except Exception as e:
        print(f'[SKIP] {screen_id}: {req_path} 파싱 실패 — {e}')
        return

    domain   = req.get('domain', '')
    uis_id   = req.get('uis_id', '')
    items    = req.get('inf_required', [])
    if not items:
        print(f'[SKIP] {screen_id}: inf_required 없음')
        return

    # spec.md 위치 탐색
    spec_path = os.path.join(workspace, 'docs', '05_설계서', domain, 'UI', screen_id, 'spec.md')
    if not os.path.exists(spec_path):
        # domain이 없는 경우 glob
        import glob
        matches = glob.glob(os.path.join(workspace, 'docs', '05_설계서', '*', 'UI', screen_id, 'spec.md'))
        spec_path = matches[0] if matches else None
    if not spec_path or not os.path.exists(spec_path):
        print(f'[SKIP] {screen_id}: spec.md 없음')
        return

    # URL → INF 매칭
    url_to_inf = {}
    unmatched  = []
    for item in items:
        url    = item.get('url', '')
        method = item.get('method', 'GET')
        result = find_inf(url, method, inf_idx)
        if result:
            inf_id, _, matched_domain = result
            url_to_inf[url] = (inf_id, matched_domain)
        else:
            unmatched.append(item)

    if url_to_inf:
        patched, err = patch_spec(spec_path, url_to_inf)
        if err:
            print(f'[ERROR] {screen_id} spec.md 패치 실패: {err}')
        else:
            print(f'[OK] {screen_id}: {patched}개 URL → INF 링크 교체 ({spec_path})')

    # inf_required 갱신 — 매칭된 것 제거
    req['inf_required'] = unmatched
    with open(req_path, 'w', encoding='utf-8') as f:
        json.dump(req, f, ensure_ascii=False, indent=2)
    if unmatched:
        print(f'  남은 미매칭 URL {len(unmatched)}건 → {req_path}')


def main():
    inf_idx = build_inf_index(WS)
    if not inf_idx:
        print('[WARNING] INF 인덱스 빈 — docs/05_설계서/*/INF/INF-*.md 없음')

    tmp_dir = os.path.join(WS, '_tmp')
    if not os.path.isdir(tmp_dir):
        print(f'[ERROR] {tmp_dir} 없음')
        sys.exit(1)

    processed = 0
    for fname in os.listdir(tmp_dir):
        if not fname.endswith('_inf_required.json'):
            continue
        screen_id = fname[:-len('_inf_required.json')]
        if SCREEN_FILTER and screen_id != SCREEN_FILTER:
            continue
        process_screen(WS, screen_id, inf_idx)
        processed += 1

    if processed == 0:
        print('처리할 _inf_required.json 없음')
    else:
        print(f'\n총 {processed}개 화면 처리 완료')


if __name__ == '__main__':
    main()
