#!/usr/bin/env python3
"""
build_domain_catalog.py — source_index.json → 범용 도메인 카탈로그

도메인 분류 기준: **relPath 디렉토리 경로**(모든 스택 공통, 언어 중립).
Java `package`나 URL 세그먼트에 의존하지 않는다 → Java Spring / Next.js / Python 등 모두 동작.

알고리즘:
  1. 라우트 보유 파일(화면/API 엔트리)만 대상.
  2. 각 엔트리의 relPath 디렉토리 세그먼트에서 공통 접두(LCP)를 제거
     (src/main/java/com/co, src/pages 등 프레임워크 보일러플레이트 자동 흡수).
  3. 남은 첫 의미 세그먼트(레이어 키워드 제외)가 도메인.
  4. 과반(>50%) 차지하는 거대 모듈(예: Java admin 모듈)은 1단계 하강해 세분화.

Usage:
    python build_domain_catalog.py [source_index_path] [output_path]
    기본값: _tmp/source_index.json → _tmp/domain_catalog.json
"""
import os
import sys
import json
from collections import Counter, OrderedDict

# 도메인이 아닌 구조/레이어 디렉토리 세그먼트
LAYER_KEYWORDS = {
    'src', 'main', 'java', 'kotlin', 'scala', 'app', 'pages', 'page',
    'com', 'org', 'net', 'io', 'kr', 'co',
    'controller', 'controllers', 'web', 'rest', 'restcontroller',
    'service', 'services', 'dao', 'mapper', 'repository', 'repo',
    'config', 'util', 'utils', 'base', 'internal', 'handler', 'handlers',
    'routes', 'router',
}


def dir_parts(rel_path: str) -> list:
    """relPath에서 파일명을 제외한 디렉토리 세그먼트 리스트 (슬래시 정규화)."""
    norm = (rel_path or '').replace('\\', '/')
    segs = [s for s in norm.split('/') if s]
    return segs[:-1] if segs else []


def longest_common_prefix(seqs: list) -> list:
    """세그먼트 리스트들의 최장 공통 접두(리스트) 반환."""
    if not seqs:
        return []
    common = list(seqs[0])
    for seq in seqs[1:]:
        i = 0
        while i < len(common) and i < len(seq) and common[i] == seq[i]:
            i += 1
        common = common[:i]
        if not common:
            break
    return common


def domain_of(parts_after_lcp: list, skip: int = 0) -> str:
    """LCP 제거된 디렉토리 세그먼트에서 (skip)번째 의미 세그먼트를 도메인으로 반환.
    의미 세그먼트 = LAYER_KEYWORDS에 없는 세그먼트. 없으면 '(root)'."""
    meaningful = [s for s in parts_after_lcp if s.lower() not in LAYER_KEYWORDS]
    if len(meaningful) > skip:
        return meaningful[skip]
    return '(root)'


def detect_stack(files: list) -> str:
    """라우트 보유 파일들로 스택 추정. nextjs(pages/app 마커) / java(package) / generic."""
    entries = [f for f in files if f.get('routes')]
    for f in entries:
        parts = dir_parts(f.get('relPath', ''))
        if 'pages' in parts or 'app' in parts:
            return 'nextjs'
    for f in entries:
        if f.get('package'):
            return 'java'
    return 'generic'


def assign_file_domains(files: list):
    """라우트 보유 파일 각각에 도메인을 할당한다 (범용 핵심 로직).
    build_catalog가 도메인 분류에 사용한다 (relPath 기반, 범용).
    반환: (pairs, common_prefix) — pairs=[(file, domain), ...]"""
    entries = [f for f in files if f.get('routes')]
    if not entries:
        return [], ''

    # 각 엔트리의 디렉토리 세그먼트 + LCP
    parts_list = [dir_parts(f.get('relPath', '')) for f in entries]
    lcp = longest_common_prefix(parts_list)
    lcp_len = len(lcp)
    after = [p[lcp_len:] for p in parts_list]

    # 모든 엔트리가 한 경로에 몰려 LCP가 도메인 디렉토리까지 먹은 경우
    # (예: src/pages/cost/* 만 존재 → LCP=src/pages/cost → 도메인 소실)
    # → trailing 레이어 세그먼트 제거 후 마지막 의미 세그먼트 1개를 도메인으로 환원
    if all(domain_of(a, 0) == '(root)' for a in after):
        while lcp and lcp[-1].lower() in LAYER_KEYWORDS:
            lcp = lcp[:-1]
        if lcp:
            lcp = lcp[:-1]  # 마지막 의미 세그먼트를 도메인 영역으로 환원
        lcp_len = len(lcp)
        after = [p[lcp_len:] for p in parts_list]

    # 과반(>50%) 지배 세그먼트를 반복 하강.
    # 회사 패키지(com.kth.nkshop.bos)·거대 모듈(admin)이 모든 파일에 공통이면
    # 과반으로 잡혀 차례로 흡수되고, 실제 구분 도메인(product/order)에서 멈춘다.
    # 소수 모듈(scm/sample)은 과반이 아니므로 그대로 유지된다.
    # 하강 결과가 (root)이면(더 세분 불가) 그 파일은 더 내려가지 않는다.
    total = len(entries)
    skip_level = [0] * total
    while True:
        cand = [domain_of(after[i], skip_level[i]) for i in range(total)]
        counts = Counter(cand)
        dominant = {d for d, c in counts.items() if c > total * 0.5 and d != '(root)'}
        if not dominant:
            break
        progressed = False
        for i in range(total):
            if cand[i] in dominant and domain_of(after[i], skip_level[i] + 1) != '(root)':
                skip_level[i] += 1
                progressed = True
        if not progressed:
            break
    cand = [domain_of(after[i], skip_level[i]) for i in range(total)]
    return list(zip(entries, cand)), '/'.join(lcp)


def build_catalog(source_index: dict) -> dict:
    """source_index dict → 도메인 카탈로그 dict (범용)."""
    files = source_index.get('files', [])
    stack = detect_stack(files)
    pairs, common_prefix = assign_file_domains(files)

    if not pairs:
        return {'stack': stack, 'common_prefix': '', 'total_files': 0, 'domains': []}

    # 집계
    domains = OrderedDict()
    for f, dom in pairs:
        d = domains.setdefault(dom, {'name': dom, 'files': 0, 'forms': 0, 'apis': 0,
                                     'dirs': set()})
        d['files'] += 1
        d['dirs'].add('/'.join(dir_parts(f.get('relPath', ''))))
        for r in f.get('routes', []):
            if r.get('kind') == 'form':
                d['forms'] += 1
            elif r.get('kind') == 'api':
                d['apis'] += 1

    domain_list = []
    for d in domains.values():
        d['dirs'] = sorted(d['dirs'])[:5]  # 대표 디렉토리 샘플
        domain_list.append(d)
    domain_list.sort(key=lambda x: (-x['files'], x['name']))

    return {
        'stack': stack,
        'common_prefix': common_prefix,
        'total_files': len(pairs),
        'domains': domain_list,
    }


def generate_catalog(source_index_path: str, output_path: str) -> dict:
    """source_index.json 읽기 → 카탈로그 생성 → 저장 → dict 반환."""
    with open(source_index_path, encoding='utf-8', errors='replace') as f:
        idx = json.load(f)
    catalog = build_catalog(idx)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    return catalog


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    src = sys.argv[1] if len(sys.argv) > 1 else '_tmp/source_index.json'
    out = sys.argv[2] if len(sys.argv) > 2 else '_tmp/domain_catalog.json'
    if not os.path.isfile(src):
        print(f'[ERROR] {src} 없음 — scan_source.js 먼저 실행')
        sys.exit(1)
    cat = generate_catalog(src, out)
    print(f'[OK] domain_catalog.json — stack={cat["stack"]} 도메인 {len(cat["domains"])}개 '
          f'(엔트리 {cat["total_files"]}개, prefix={cat["common_prefix"]})')
    for d in cat['domains']:
        print(f'  {d["name"]:<20} files {d["files"]:>4}  form {d["forms"]:>4}  api {d["apis"]:>4}')
    print(f'  → {out}')
