# STATUS: 완료
#!/usr/bin/env python3
"""
extract_entities.py — SR 본문 + 첨부 추출(_extracted.md)에서 변경 엔티티 자동추출 (zero-LLM 1차)
T1-A. build_change_context의 --entities 입력(가장 어려운 부분)을 구조화한다.

전략:
  1) 그래프 어휘 사전 매칭 — 스펙 frontmatter의 테이블명/INF-ID/path를 정답 어휘로 사용(정밀도↑).
  2) 휴리스틱 — INF-ID 정규식, UPPER_SNAKE 테이블 후보(어휘 교차검증), path 세그먼트.
출력: docs/변경관리/{SR-ID}/_entities.json {tables,infs,paths,screens,terms} + 출처.

Usage:
  python extract_entities.py <workspace> [--sr SR-ID] [--text "..."]
  --sr 주면 docs/변경관리/{SR}/00_요구사항.md + _extracted.md 를 읽는다.
"""
import os, sys, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

INF_RE = re.compile(r'\bINF-[A-Z]{2,5}-\d{2,4}\b')
SNAKE_RE = re.compile(r'\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b')   # UPPER_SNAKE (테이블 후보)
PATH_RE = re.compile(r'/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)+')

def _read_sr(ws, sr):
    parts = []
    for rel in (f'docs/변경관리/{sr}/00_요구사항.md', f'docs/변경관리/{sr}/_extracted.md'):
        p = os.path.join(ws, rel)
        if os.path.exists(p):
            parts.append(open(p, encoding='utf-8', errors='replace').read())
    return '\n'.join(parts)

def extract(ws, text):
    graph = sgb.build_graph(ws)
    known_tables = set(graph['table_to_inf']) | set(graph['table_to_sch'])
    known_infs = set(graph['inf'])
    known_paths = {(graph['inf'][i].get('path') or '') for i in graph['inf']}
    known_paths.discard('')

    up = text.upper()
    tables = sorted({t for t in known_tables if t in up})
    # 어휘에 없지만 UPPER_SNAKE인 후보(미확인 — 별도)
    snake_cand = sorted({m.group(0) for m in SNAKE_RE.finditer(text)} - set(tables) - {'INF'})
    unknown_tables = [t for t in snake_cand if t not in known_tables]

    infs = sorted(set(INF_RE.findall(text)) & known_infs)
    infs_text = sorted(set(INF_RE.findall(text)))  # 텍스트의 모든 INF-ID

    paths = sorted({p for p in known_paths if p and p in text})
    path_cand = sorted({m.group(0) for m in PATH_RE.finditer(text)})

    return {
        'tables': tables,
        'tables_unknown': unknown_tables,         # 그래프 미존재 후보(검토용)
        'infs': infs,
        'infs_unmatched': [i for i in infs_text if i not in known_infs],
        'paths': paths,
        'paths_candidate': [p for p in path_cand if p not in paths],
        'screens': [],
        'terms': [],
        'entities_arg': ','.join(tables + infs + paths),   # build_change_context --entities 직접 입력용
    }

def main():
    argv = sys.argv[1:]
    ws, sr, text = '.', None, None
    i = 0
    while i < len(argv):
        if argv[i] == '--sr' and i+1 < len(argv):
            sr = argv[i+1]; i += 2
        elif argv[i] == '--text' and i+1 < len(argv):
            text = argv[i+1]; i += 2
        elif not argv[i].startswith('--'):
            ws = argv[i]; i += 1
        else:
            i += 1
    if text is None and sr:
        text = _read_sr(ws, sr)
    if not text:
        print('입력 없음 — --sr 또는 --text 필요'); return 1
    ents = extract(ws, text)
    if sr:
        out_dir = os.path.join(ws, 'docs', '변경관리', sr)
        os.makedirs(out_dir, exist_ok=True)
        p = os.path.join(out_dir, '_entities.json')
        json.dump(ents, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f'엔티티: {p}')
    print(json.dumps(ents, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__':
    sys.exit(main())
