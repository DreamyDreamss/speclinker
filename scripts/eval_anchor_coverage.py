# STATUS: 완료
#!/usr/bin/env python3
"""
eval_anchor_coverage.py — 앵커 체인 커버리지 + 메타 정확도 측정 (4-4, eval_fidelity 대체)

검증 가능·드리프트 없음·정답 불필요한 품질지표:
  1) 앵커 체인 커버리지 — INF 앵커가 controller/service/sql(dao,mapper) 단계를 얼마나 덮나.
     특히 **SQL 앵커 보유율**(full-chain 4-1의 핵심 효과 — 이전엔 controller만).
  2) 메타 정확도 — frontmatter method/path/tables 채워짐.
  3) (있으면) 코드값 해소 신호.

Usage: python eval_anchor_coverage.py <root> [--sample N]
출력: docs/report/eval/anchor_coverage.json + 콘솔
"""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

def stage(anchor):
    p = anchor.split(':', 1)[0].lower()
    base = os.path.basename(p)
    if p.endswith(('.xml', '.sql')) or 'mapper' in base or base.rstrip('.java').endswith('dao') or '/dao/' in p or 'sqlmap' in p:
        return 'sql'
    if base.replace('.java', '').endswith(('service', 'serviceimpl')) or '/service/' in p:
        return 'service'
    if 'controller' in base or '/controller/' in p:
        return 'controller'
    return 'other'

def evaluate(root, sample=0):
    graph = sgb.build_graph(root)
    iids = list(graph['inf'])
    random.seed(42)
    if sample and len(iids) > sample:
        iids = random.sample(iids, sample)
    total = len(iids)
    has_ctrl = has_svc = has_sql = 0
    meta_path = meta_method = meta_tables = 0
    stage_dist = {'controller': 0, 'service': 0, 'sql': 0, 'other': 0}
    for iid in iids:
        n = graph['inf'][iid]
        stages = {stage(a) for a in n.get('anchors', [])}
        for s in stages:
            stage_dist[s] = stage_dist.get(s, 0) + 1
        has_ctrl += 1 if 'controller' in stages else 0
        has_svc += 1 if 'service' in stages else 0
        has_sql += 1 if 'sql' in stages else 0
        meta_path += 1 if n.get('path') else 0
        meta_method += 1 if n.get('method') else 0
        meta_tables += 1 if n.get('tables') else 0
    f = lambda x: (x / total) if total else 0.0
    return {'inf_total': total,
            'has_controller_rate': f(has_ctrl), 'has_service_rate': f(has_svc),
            'has_sql_rate': f(has_sql),
            'meta_path_rate': f(meta_path), 'meta_method_rate': f(meta_method),
            'meta_tables_rate': f(meta_tables),
            'stage_distribution': stage_dist}

def main():
    argv = sys.argv[1:]
    root = next((a for a in argv if not a.startswith('--')), '.')
    sample = int(argv[argv.index('--sample') + 1]) if '--sample' in argv else 0
    rep = evaluate(root, sample)
    out_dir = os.path.join(root, 'docs', 'report', 'eval')
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, 'anchor_coverage.json')
    json.dump(rep, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'[앵커 커버리지] INF {rep["inf_total"]}건')
    print(f'  controller {rep["has_controller_rate"]:.1%} / service {rep["has_service_rate"]:.1%} / SQL {rep["has_sql_rate"]:.1%}')
    print(f'  메타 정확: path {rep["meta_path_rate"]:.1%} / method {rep["meta_method_rate"]:.1%} / tables {rep["meta_tables_rate"]:.1%}')
    print(f'  → {p}  (SQL 보유율↑ = full-chain 앵커 4-1 효과)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
