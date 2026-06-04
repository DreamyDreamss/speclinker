# STATUS: 완료
#!/usr/bin/env python3
"""
build_change_context.py — SR 엔티티 → 영향슬라이스 + 소스앵커 브리프 (zero-LLM, JIT 리트리버)
sl-change AS-IS 그라운딩. 요약 스펙 본문은 싣지 않고 앵커(file:line)만 → 에이전트가 실소스 read.
Usage:
  python build_change_context.py <workspace> [--sr SR-ID] --entities "kw1,kw2,INF-..,TABLE.."
"""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

def parse_args(argv):
    ws, sr, ents = '.', '_adhoc', []
    ubiquity, top, hops = 20, 30, 1
    i = 0
    while i < len(argv):
        if argv[i] == '--sr' and i + 1 < len(argv):
            sr = argv[i + 1]; i += 2
        elif argv[i] == '--entities' and i + 1 < len(argv):
            ents = [e.strip() for e in re.split(r'[,\s]+', argv[i + 1]) if e.strip()]; i += 2
        elif argv[i] == '--ubiquity' and i + 1 < len(argv):
            ubiquity = int(argv[i + 1]); i += 2
        elif argv[i] == '--top' and i + 1 < len(argv):
            top = int(argv[i + 1]); i += 2
        elif argv[i] == '--hops' and i + 1 < len(argv):
            hops = int(argv[i + 1]); i += 2
        elif not argv[i].startswith('--'):
            ws = argv[i]; i += 1
        else:
            i += 1
    return ws, sr, ents, ubiquity, top, hops

def match_seed(graph, ents):
    """엔티티 → 직접 매칭 INF/table 시드."""
    inf_seed, table_seed = set(), set()
    for e in ents:
        eu = e.upper()
        if eu in graph['inf']:
            inf_seed.add(eu)
        if eu in graph['table_to_inf'] or eu in graph['table_to_sch']:
            table_seed.add(eu)
        for iid, n in graph['inf'].items():
            if e and (e.lower() in (n.get('path') or '').lower()):
                inf_seed.add(iid)
    return inf_seed, table_seed

def expand(graph, inf_seed, table_seed, ubiquity=20, hops=1):
    """forward + reverse(ripple) 확장 + 편재자원 격리 + 관련도 점수.
    반환: scores{iid:score}, via{iid:table}, tables, schs, ubiquitous[(table,users)], ripple_n."""
    scores = {iid: 1.0 for iid in inf_seed}   # 직접 매칭 INF = 1.0
    via = {iid: '(직접)' for iid in inf_seed}
    tables = set(table_seed)
    for iid in inf_seed:
        tables |= set(graph['inf'][iid]['tables'])

    ubiquitous = []          # (table, users) — 편재 공통자원(개별 나열 안 함)
    schs = set()
    frontier = set(tables)
    seen_tables = set()
    for hop in range(max(1, hops)):
        next_frontier = set()
        for t in frontier:
            if t in seen_tables:
                continue
            seen_tables.add(t)
            users = graph['table_to_inf'].get(t, [])
            for s in graph['table_to_sch'].get(t, []):
                schs.add(s)
            if len(users) > ubiquity:
                ubiquitous.append((t, len(users)))   # 격리 — users 미전개
                continue
            edge_score = 1.0 / max(1, len(users))     # 사용처 적을수록 관련도↑
            for u in users:
                sc = scores.get(u, 0.0)
                scores[u] = max(sc, edge_score)
                via.setdefault(u, t)
                if hop + 1 < hops:                    # 전이 확장(옵션)
                    next_frontier |= set(graph['inf'].get(u, {}).get('tables', []))
        frontier = next_frontier
    ripple_n = sum(1 for iid in scores if iid not in inf_seed)
    return scores, via, sorted(tables), schs, ubiquitous, ripple_n

def emit_brief(root, sr, graph, scores, via, tables, schs, ubiquitous, ents, top):
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    lines = [f'# AS-IS 브리프 — {sr}', '',
             f'요청 엔티티: {", ".join(ents)}', '',
             '> 요약 스펙 본문 대신 **소스앵커**를 싣는다. 에이전트는 아래 file:line을 Read하여 최신·정밀 AS-IS를 확보한다.',
             f'> 영향 INF {len(scores)}건 중 관련도 상위 {min(top, len(scores))}건. 편재 공통자원은 하단 별도 격리.', '']
    lines.append('## 영향 INF (관련도 순 — 점수·연결경로·소스앵커)')
    for iid, sc in ranked[:top]:
        n = graph['inf'].get(iid, {})
        lines.append(f"- **{iid}** `{sc:.2f}` ({via.get(iid, '?')})  {n.get('method', '')} {n.get('path', '')}  ·  {n.get('file', '')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    if len(scores) > top:
        lines.append(f"- … 외 {len(scores) - top}건(관련도 하위, 생략)")
    lines.append('\n## 영향 SCH')
    for sid in sorted(schs):
        n = graph['sch'].get(sid, {})
        lines.append(f"- **{sid}** ({n.get('table', '')})  ·  {n.get('file', '')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    lines.append('\n## 영향 테이블')
    lines.append(', '.join(tables) or '(없음)')
    if ubiquitous:
        lines.append('\n## ⚠️ 광역 공통자원 (편재 — 개별 검토 권장, 자동 나열 생략)')
        lines.append('> 아래 테이블은 사용처가 광범위(공통코드 등)하여 개별 INF를 나열하지 않는다. 변경 시 영향이 전역적이므로 신중 검토.')
        for t, cnt in sorted(ubiquitous, key=lambda x: -x[1]):
            lines.append(f"- `{t}` — **{cnt}개** INF에서 사용 (광역 영향)")
    out_dir = os.path.join(root, 'docs', '변경관리', sr)
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, '_asis_brief.md')
    open(p, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return p

def main():
    ws, sr, ents, ubiquity, top, hops = parse_args(sys.argv[1:])
    if not ents:
        print('엔티티 없음 — --entities 필요')
        return 1
    graph = sgb.build_graph(ws)
    inf_seed, table_seed = match_seed(graph, ents)
    scores, via, tables, schs, ubiquitous, ripple_n = expand(graph, inf_seed, table_seed, ubiquity, hops)
    p = emit_brief(ws, sr, graph, scores, via, tables, schs, ubiquitous, ents, top)
    print(f'AS-IS 브리프: {p}')
    print(f'영향 INF {len(scores)} / SCH {len(schs)} / 테이블 {len(tables)} / ripple {ripple_n} / 광역공통자원 {len(ubiquitous)}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
