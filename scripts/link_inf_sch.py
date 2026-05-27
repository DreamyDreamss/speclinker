"""
link_inf_sch.py — SCH 생성 완료 후 INF ## 참조 테이블의 [TBD]를 SCH 링크로 교체

INF 작성 시점에 SCH가 없어서 [TBD]만 적혀있던 ## 참조 테이블 셀을
ddd-db-agent가 SCH를 생성한 뒤 이 스크립트로 일괄 링크화.

LLM 재호출 없이 스크립트로 처리 — 토큰 절약.

입력:
  - _tmp/{inf_id}_sch_required.json  (ddd-api-agent가 출력)
  - docs/05_설계서/{domain}/DB_{domain}.md (생성된 SCH 파일들)
  - docs/05_설계서/{domain}/INF/{inf_id}.md (패치 대상)

출력:
  - INF-*.md ## 참조 테이블 내 [TBD] → [SCH-NNN](../DB_{domain}.md#SCH-NNN) 교체
  - _tmp/{inf_id}_sch_required.json 의 매칭된 항목 제거 (남은 것 = 아직 SCH 없음)

사용:
  python3 link_inf_sch.py [workspace]
  python3 link_inf_sch.py [workspace] --inf-id=INF-205
"""
import glob
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
INF_FILTER = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--inf-id=')), None)


def build_sch_index(workspace):
    """모든 도메인의 DB_*.md 스캔 → {TABLE_UPPER: (sch_id, domain, db_filename)} 인덱스."""
    idx = {}
    design_root = os.path.join(workspace, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return idx
    for domain in os.listdir(design_root):
        domain_dir = os.path.join(design_root, domain)
        if not os.path.isdir(domain_dir):
            continue
        for fname in os.listdir(domain_dir):
            if not (fname.startswith('DB_') and fname.endswith('.md')):
                continue
            fpath = os.path.join(domain_dir, fname)
            try:
                body = open(fpath, encoding='utf-8').read()
            except Exception:
                continue
            # ## SCH-NNN: TABLE_NAME 패턴 추출
            for m in re.finditer(r'^## (SCH-\d+):\s*(\S+)', body, re.M):
                sch_id = m.group(1)
                table  = m.group(2).upper()
                idx[table] = (sch_id, domain, fname)
    return idx


def find_sch(table_name, sch_idx):
    """테이블명 → SCH 매핑. 대소문자 무시 + prefix 폴백."""
    key = table_name.upper()
    if key in sch_idx:
        return sch_idx[key]
    # prefix 매칭 (테이블명이 일부만 일치할 때)
    for k, v in sch_idx.items():
        if len(k) > 3 and (k.startswith(key) or key.startswith(k)):
            return v
    return None


def patch_inf(inf_path, table_to_sch):
    """INF-*.md ## 참조 테이블 섹션의 [TBD]를 SCH 링크로 교체."""
    try:
        body = open(inf_path, encoding='utf-8').read()
    except Exception as e:
        return 0, str(e)

    before  = body
    patched = 0
    for table, (sch_id, domain, db_fname) in table_to_sch.items():
        link = f'[{sch_id}](../{db_fname}#{sch_id})'
        # 패턴: | TABLE_NAME | [TBD] | 또는 | TABLE_NAME | TABLE_NAME |
        body = re.sub(
            r'(\|\s*' + re.escape(table) + r'\s*\|\s*)(\[TBD\]|' + re.escape(table) + r')(\s*\|)',
            r'\g<1>' + link + r'\g<3>',
            body,
            flags=re.I
        )
        if body != before:
            patched += 1
            before = body

    if patched > 0:
        with open(inf_path, 'w', encoding='utf-8') as f:
            f.write(body)
    return patched, ''


def process_inf(workspace, inf_id, sch_idx):
    """_tmp/{inf_id}_sch_required.json 읽어서 매칭 후 INF 파일 패치."""
    req_path = os.path.join(workspace, '_tmp', f'{inf_id}_sch_required.json')
    if not os.path.exists(req_path):
        return

    try:
        req = json.load(open(req_path, encoding='utf-8'))
    except Exception as e:
        print(f'[SKIP] {inf_id}: {req_path} 파싱 실패 — {e}')
        return

    domain = req.get('domain', '')
    tables = req.get('tables', [])
    if not tables:
        print(f'[SKIP] {inf_id}: tables 없음')
        return

    # INF 파일 위치 탐색
    inf_path = os.path.join(workspace, 'docs', '05_설계서', domain, 'INF', f'{inf_id}.md')
    if not os.path.exists(inf_path):
        matches = glob.glob(os.path.join(workspace, 'docs', '05_설계서', '*', 'INF', f'{inf_id}.md'))
        inf_path = matches[0] if matches else None
    if not inf_path or not os.path.exists(inf_path):
        print(f'[SKIP] {inf_id}: INF 파일 없음')
        return

    # 테이블 → SCH 매칭
    table_to_sch = {}
    unmatched    = []
    for table in tables:
        result = find_sch(table, sch_idx)
        if result:
            table_to_sch[table.upper()] = result
        else:
            unmatched.append(table)

    if table_to_sch:
        patched, err = patch_inf(inf_path, table_to_sch)
        if err:
            print(f'[ERROR] {inf_id} INF 패치 실패: {err}')
        else:
            matched_ids = [v[0] for v in table_to_sch.values()]
            print(f'[OK] {inf_id}: {patched}개 테이블 → SCH 링크 교체 {matched_ids} ({inf_path})')

    # sch_required 갱신 — 매칭된 것 제거
    req['tables'] = unmatched
    with open(req_path, 'w', encoding='utf-8') as f:
        json.dump(req, f, ensure_ascii=False, indent=2)
    if unmatched:
        print(f'  남은 미매칭 테이블 {len(unmatched)}건 → {req_path}')


def main():
    sch_idx = build_sch_index(WS)
    if not sch_idx:
        print('[WARNING] SCH 인덱스 빈 — docs/05_설계서/*/DB_*.md 없음')

    tmp_dir = os.path.join(WS, '_tmp')
    if not os.path.isdir(tmp_dir):
        print(f'[ERROR] {tmp_dir} 없음')
        sys.exit(1)

    processed = 0
    for fname in sorted(os.listdir(tmp_dir)):
        if not fname.endswith('_sch_required.json'):
            continue
        inf_id = fname[:-len('_sch_required.json')]
        if INF_FILTER and inf_id != INF_FILTER:
            continue
        process_inf(WS, inf_id, sch_idx)
        processed += 1

    if processed == 0:
        print('처리할 _sch_required.json 없음')
    else:
        print(f'\n총 {processed}개 INF 처리 완료')


if __name__ == '__main__':
    main()
