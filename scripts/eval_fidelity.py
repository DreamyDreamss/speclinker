# STATUS: DEPRECATED — eval_anchor_coverage.py(4-4)로 대체.
# 이유: 산문/스펙 tables vs SQL 정규식 self-consistency는 *정답 없는 프록시*라 충실도가 아님
#       (nkshop P0.70/R0.18은 측정 아티팩트). 검증 가능한 지표 = 앵커 체인 커버리지 + 메타 정확도.
#!/usr/bin/env python3
"""
eval_fidelity.py — [DEPRECATED] 스펙 충실도 측정 하네스 (T3-A, 논문 H1)
※ eval_anchor_coverage.py로 대체. 아래는 self-consistency 프록시(충실도 아님) — 참고용 보존.

두 가지 측정:
  1) [자동] 테이블 추출 일치도 — INF `tables:` frontmatter vs 앵커 SQL의 실제 테이블.
     precision/recall/F1 (사람 주석 불요, 스펙-소스 self-consistency 신호).
  2) [반자동] 비즈규칙 충실도 — 주석 워크시트 생성 → 전문가 정답 입력 후 채점.

Usage:
  python eval_fidelity.py <root> --auto-tables [--sample N]      # 자동 일치도
  python eval_fidelity.py <root> --worksheet [--sample N]        # 주석 워크시트 생성
"""
import os, sys, re, json, glob, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

_TBL_RE = re.compile(r'\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+[`"\[]?([A-Za-z_][A-Za-z0-9_]*)', re.IGNORECASE)
_NOISE = {'DUAL', 'SELECT', 'WHERE', 'SET', 'VALUES'}

def tables_from_sql(text):
    out = set()
    for m in _TBL_RE.finditer(text or ''):
        t = m.group(1).upper()
        if t not in _NOISE and not t.isdigit():
            out.add(t)
    return out

def _anchor_sql_tables(root, anchors):
    found = set()
    for a in anchors:
        src = a.split(':', 1)[0].strip()
        p = os.path.join(root, src)
        if not os.path.exists(p):
            continue
        if not src.lower().endswith(('.xml', '.sql')):
            continue
        try:
            found |= tables_from_sql(open(p, encoding='utf-8', errors='ignore').read())
        except OSError:
            pass
    return found

def score_consistency(root, sample=0):
    graph = sgb.build_graph(root)
    iids = list(graph['inf'])
    random.seed(42)
    if sample and len(iids) > sample:
        iids = random.sample(iids, sample)
    tp = fp = fn = 0
    evaluated = 0
    detail = []
    for iid in iids:
        n = graph['inf'][iid]
        spec_t = set(n.get('tables', []))
        src_t = _anchor_sql_tables(root, n.get('anchors', []))
        if not spec_t or not src_t:
            continue  # SQL 앵커 없으면 평가 불가
        evaluated += 1
        inter = spec_t & src_t
        tp += len(inter); fp += len(spec_t - src_t); fn += len(src_t - spec_t)
        detail.append({'inf': iid, 'spec_only': sorted(spec_t - src_t),
                       'src_only': sorted(src_t - spec_t)})
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return {'inf_evaluated': evaluated, 'precision': prec, 'recall': rec, 'f1': f1,
            'tp': tp, 'fp': fp, 'fn': fn, 'detail': detail[:50]}

def make_worksheet(root, sample=20):
    graph = sgb.build_graph(root)
    iids = list(graph['inf'])
    random.seed(42)
    if sample and len(iids) > sample:
        iids = random.sample(iids, sample)
    lines = ['# 충실도 주석 워크시트 (전문가용)', '',
             '> 각 INF의 추출 항목이 실제 소스와 일치하는지 정답을 채워 점수화한다.', '']
    for iid in iids:
        n = graph['inf'][iid]
        lines.append(f'## {iid} — {n.get("method","")} {n.get("path","")}')
        lines.append(f'- 추출 테이블: {", ".join(n.get("tables", [])) or "(없음)"}')
        lines.append(f'- 근거소스: {", ".join(n.get("anchors", [])) or "(없음)"}')
        lines.append('- [정답] 누락 테이블: ____   오추출 테이블: ____   비즈규칙 정확도(0~5): __')
        lines.append('')
    return '\n'.join(lines)

def main():
    argv = sys.argv[1:]
    root = next((a for a in argv if not a.startswith('--')), '.')
    sample = 0
    if '--sample' in argv:
        sample = int(argv[argv.index('--sample') + 1])
    out_dir = os.path.join(root, 'docs', 'report', 'eval')
    os.makedirs(out_dir, exist_ok=True)
    if '--worksheet' in argv:
        ws = make_worksheet(root, sample or 20)
        p = os.path.join(out_dir, 'fidelity_worksheet.md')
        open(p, 'w', encoding='utf-8').write(ws)
        print(f'워크시트: {p}')
        return 0
    # 기본: 자동 일치도
    rep = score_consistency(root, sample)
    p = os.path.join(out_dir, 'fidelity_auto.json')
    json.dump(rep, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'[자동 테이블 일치도] INF {rep["inf_evaluated"]}건 평가')
    print(f'  precision={rep["precision"]:.3f}  recall={rep["recall"]:.3f}  F1={rep["f1"]:.3f}')
    print(f'  (tp={rep["tp"]} fp={rep["fp"]} fn={rep["fn"]})  → {p}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
