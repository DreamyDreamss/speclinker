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
    i = 0
    while i < len(argv):
        if argv[i] == '--sr' and i + 1 < len(argv):
            sr = argv[i + 1]; i += 2
        elif argv[i] == '--entities' and i + 1 < len(argv):
            ents = [e.strip() for e in re.split(r'[,\s]+', argv[i + 1]) if e.strip()]; i += 2
        elif not argv[i].startswith('--'):
            ws = argv[i]; i += 1
        else:
            i += 1
    return ws, sr, ents

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

def expand(graph, inf_seed, table_seed):
    """forward + reverse(ripple) 1홉 확장."""
    infs, tables, schs, ripple = set(inf_seed), set(table_seed), set(), []
    for iid in inf_seed:
        for t in graph['inf'][iid]['tables']:
            tables.add(t)
    for t in tables:
        for u in graph['table_to_inf'].get(t, []):
            if u not in infs:
                ripple.append((t, u))
            infs.add(u)
        for s in graph['table_to_sch'].get(t, []):
            schs.add(s)
    return infs, tables, schs, ripple

def emit_brief(root, sr, graph, infs, tables, schs, ripple, ents):
    lines = [f'# AS-IS 브리프 — {sr}', '',
             f'요청 엔티티: {", ".join(ents)}', '',
             '> 요약 스펙 본문 대신 **소스앵커**를 싣는다. 에이전트는 아래 file:line을 Read하여 최신·정밀 AS-IS를 확보한다.', '']
    lines.append('## 영향 INF (+ 근거소스 앵커)')
    for iid in sorted(infs):
        n = graph['inf'].get(iid, {})
        lines.append(f"- **{iid}** {n.get('method', '')} {n.get('path', '')}  ·  {n.get('file', '')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    lines.append('\n## 영향 SCH')
    for sid in sorted(schs):
        n = graph['sch'].get(sid, {})
        lines.append(f"- **{sid}** ({n.get('table', '')})  ·  {n.get('file', '')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    lines.append('\n## 영향 테이블')
    lines.append(', '.join(sorted(tables)) or '(없음)')
    if ripple:
        lines.append('\n## ⚠️ Ripple 경고 (공유테이블 사용처 — 회귀 위험)')
        for t, u in ripple:
            lines.append(f"- `{t}` 변경 시 **{u}** 영향 (시드 외 사용처)")
    out_dir = os.path.join(root, 'docs', '변경관리', sr)
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, '_asis_brief.md')
    open(p, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return p

def main():
    ws, sr, ents = parse_args(sys.argv[1:])
    if not ents:
        print('엔티티 없음 — --entities 필요')
        return 1
    graph = sgb.build_graph(ws)
    inf_seed, table_seed = match_seed(graph, ents)
    infs, tables, schs, ripple = expand(graph, inf_seed, table_seed)
    p = emit_brief(ws, sr, graph, infs, tables, schs, ripple, ents)
    print(f'AS-IS 브리프: {p}')
    print(f'영향 INF {len(infs)} / SCH {len(schs)} / 테이블 {len(tables)} / ripple {len(ripple)}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
