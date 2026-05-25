"""
tests/run_matrix.py
Phase 5.2 — 회귀 측정 도구.

run_smoke.py가 단순 pass/fail이라면, 본 도구는
1. probe / call_chain / sch_draft / strategy 합성 각 단계별 정확도 측정
2. precision / recall 계산 (expected 대비 actual)
3. fixture 매트릭스 보고서 (markdown)

사용법:
  python3 tests/run_matrix.py
  python3 tests/run_matrix.py --out tests/_results/benchmark.md
  python3 tests/run_matrix.py --baseline tests/_results/previous.json  # 회귀 비교
"""
import os
import sys
import json
import argparse
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT, 'scripts')
SMOKE_DIR   = os.path.join(ROOT, 'tests', 'smoke')

sys.path.insert(0, SCRIPTS_DIR)
import probe                           # noqa: E402
import resolve_call_chain as rcc       # noqa: E402


def measure_probe(fixture_dir: str, exp: dict) -> dict:
    """probe.py 측정: 각 indicator의 정확도"""
    t0 = time.time()
    result = probe.probe(fixture_dir)
    dt = time.time() - t0
    ind = result['indicators']
    e = exp.get('probe_expectations', {}) or {}

    checks = {}
    if 'likely_backend_lang' in e:
        checks['backend_lang']      = (ind['likely_backend_lang'] == e['likely_backend_lang'])
    if 'likely_backend_framework' in e:
        checks['backend_framework'] = (ind['likely_backend_framework'] == e['likely_backend_framework'])
    if 'likely_persistence_contains' in e:
        checks['persistence']       = (e['likely_persistence_contains'] in (ind['likely_persistence'] or []))
    if 'likely_frontend_framework' in e:
        checks['frontend_framework'] = (ind['likely_frontend_framework'] == e['likely_frontend_framework'])
    if 'architecture_hint_contains' in e:
        target = e['architecture_hint_contains']
        checks['architecture_hint'] = any(target in h for h in ind['architecture_hints'])

    passed = sum(1 for v in checks.values() if v)
    return {
        'duration_s':     round(dt, 3),
        'checks':         checks,
        'passed':         passed,
        'total':          len(checks),
        'accuracy':       round(passed / max(len(checks), 1), 3),
        'manifests_seen': len(result.get('manifests', {})),
        'extensions':     len(result.get('extension_distribution', {})),
    }


def measure_call_chain(fixture_dir: str, exp: dict) -> dict:
    """resolve_call_chain.py 측정"""
    e = exp.get('call_chain_expectations') or {}
    if not e:
        return {'skipped': True, 'reason': 'no call_chain_expectations'}

    controller_rel = e.get('controller')
    if not controller_rel:
        return {'skipped': True, 'reason': 'no controller in expected'}
    controller = os.path.join(fixture_dir, controller_rel.replace('/', os.sep))
    if not os.path.exists(controller):
        return {'skipped': True, 'reason': f'controller file missing: {controller_rel}'}

    t0 = time.time()
    chain = rcc.resolve_chain(controller, fixture_dir)
    dt = time.time() - t0

    def norm_set(paths):
        return {p.replace('\\', '/').lower() for p in paths}

    services = norm_set(chain.get('service') or [])
    daos     = norm_set(chain.get('dao') or [])
    queries  = norm_set(chain.get('query') or [])
    all_resolved = services | daos | queries

    targets = {
        'service':  e.get('service_must_resolve_to'),
        'dao':      e.get('dao_must_resolve_to'),
        'query':    e.get('query_must_resolve_to'),
        'domain':   e.get('domain_must_resolve_to'),
    }
    hits = {}
    for k, target in targets.items():
        if not target:
            continue
        t = target.lower()
        hits[k] = any(p.endswith(t) for p in all_resolved)

    passed = sum(1 for v in hits.values() if v)
    return {
        'duration_s':       round(dt, 3),
        'total_resolved':   len(all_resolved),
        'service_n':        len(services),
        'dao_n':            len(daos),
        'query_n':          len(queries),
        'targets':          hits,
        'passed':           passed,
        'total':            len(hits),
        'accuracy':         round(passed / max(len(hits), 1), 3),
    }


def measure_strategy_resolution(fixture_dir: str) -> dict:
    """fixture에 profile.yaml이 있으면 strategy 합성 결과 측정"""
    profile_path = os.path.join(fixture_dir, '.speclinker', 'profile.yaml')
    if not os.path.exists(profile_path):
        return {'skipped': True, 'reason': 'no profile.yaml'}
    follow, skip, depth = rcc.load_effective_layers(fixture_dir)
    default_follow = set(rcc.DEFAULT_FOLLOW_LAYERS)
    default_skip   = set(rcc.DEFAULT_SKIP_LAYERS)
    added_follow = sorted(follow - default_follow)
    removed_skip = sorted(default_skip - skip)
    added_skip   = sorted(skip - default_skip)
    return {
        'follow_total':       len(follow),
        'skip_total':         len(skip),
        'max_depth':          depth,
        'follow_added':       added_follow,
        'skip_added':         added_skip,
        'skip_removed':       removed_skip,
        'strategy_effective': len(added_follow) > 0 or len(added_skip) > 0,
    }


def run_fixture(name: str) -> dict:
    fixture_dir = os.path.join(SMOKE_DIR, name)
    exp_path = os.path.join(fixture_dir, 'expected.json')
    exp = json.load(open(exp_path, encoding='utf-8')) if os.path.exists(exp_path) else {}
    return {
        'fixture':         name,
        'description':     exp.get('description', ''),
        'probe':           measure_probe(fixture_dir, exp),
        'call_chain':      measure_call_chain(fixture_dir, exp),
        'strategy':        measure_strategy_resolution(fixture_dir),
    }


def aggregate(results: list) -> dict:
    """전체 통계 집계"""
    probe_scores = [r['probe']['accuracy'] for r in results if 'accuracy' in r['probe']]
    cc_scores = [r['call_chain']['accuracy'] for r in results if not r['call_chain'].get('skipped')]
    return {
        'fixtures':        len(results),
        'probe_mean':      round(sum(probe_scores) / max(len(probe_scores), 1), 3) if probe_scores else 0,
        'probe_perfect':   sum(1 for s in probe_scores if s == 1.0),
        'call_chain_mean': round(sum(cc_scores) / max(len(cc_scores), 1), 3) if cc_scores else 0,
        'call_chain_perfect': sum(1 for s in cc_scores if s == 1.0),
        'call_chain_skipped': sum(1 for r in results if r['call_chain'].get('skipped')),
    }


def render_markdown(results: list, agg: dict) -> str:
    lines = ['# Speclinker 회귀 매트릭스 보고서', '']
    lines.append(f'**fixture {agg["fixtures"]}종 / probe 평균 {agg["probe_mean"]} / call_chain 평균 {agg["call_chain_mean"]}**')
    lines.append('')
    lines.append('## 요약')
    lines.append('')
    lines.append('| fixture | probe | call_chain | strategy 추가 follow |')
    lines.append('|---------|-------|------------|----------------------|')
    for r in results:
        p = r['probe']
        c = r['call_chain']
        s = r['strategy']
        probe_cell = f'{p["passed"]}/{p["total"]} ({p["accuracy"]:.2f})'
        if c.get('skipped'):
            cc_cell = f"⊘ {c.get('reason', '')[:25]}"
        else:
            cc_cell = f'{c["passed"]}/{c["total"]} ({c["accuracy"]:.2f})'
        st_cell = ('+' + str(len(s.get('follow_added', [])))) if not s.get('skipped') else '-'
        lines.append(f'| `{r["fixture"]}` | {probe_cell} | {cc_cell} | {st_cell} |')
    lines.append('')
    lines.append('## fixture 별 세부')
    lines.append('')
    for r in results:
        lines.append(f'### `{r["fixture"]}` — {r["description"]}')
        lines.append('')
        lines.append('**probe**:')
        for chk, ok in r['probe']['checks'].items():
            lines.append(f'- {"✓" if ok else "✗"} {chk}')
        if not r['call_chain'].get('skipped'):
            cc = r['call_chain']
            lines.append('')
            lines.append('**call_chain**:')
            lines.append(f'- service={cc["service_n"]}, dao={cc["dao_n"]}, query={cc["query_n"]}, total={cc["total_resolved"]}')
            for t, ok in cc['targets'].items():
                lines.append(f'- {"✓" if ok else "✗"} {t}_must_resolve_to')
        if not r['strategy'].get('skipped') and r['strategy']['strategy_effective']:
            s = r['strategy']
            lines.append('')
            lines.append('**strategy 합성 (DEFAULT 대비)**:')
            if s['follow_added']:
                lines.append(f'- follow_added: `{", ".join(s["follow_added"])}`')
            if s['skip_added']:
                lines.append(f'- skip_added: `{", ".join(s["skip_added"])}`')
            if s['skip_removed']:
                lines.append(f'- skip_removed: `{", ".join(s["skip_removed"])}`')
            lines.append(f'- max_depth: {s["max_depth"]}')
        lines.append('')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='', help='markdown 출력 경로')
    parser.add_argument('--json', default='', help='JSON 결과 저장 경로')
    parser.add_argument('--baseline', default='', help='이전 JSON 결과와 비교')
    args = parser.parse_args()

    fixtures = sorted(
        d for d in os.listdir(SMOKE_DIR)
        if os.path.isdir(os.path.join(SMOKE_DIR, d))
    )
    results = [run_fixture(f) for f in fixtures]
    agg = aggregate(results)

    md = render_markdown(results, agg)
    print(md)

    if args.out:
        os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
        open(args.out, 'w', encoding='utf-8').write(md)
        print(f'\nmarkdown 저장: {args.out}')

    if args.json:
        os.makedirs(os.path.dirname(args.json) or '.', exist_ok=True)
        json.dump({'aggregate': agg, 'results': results},
                  open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f'JSON 저장: {args.json}')

    if args.baseline and os.path.exists(args.baseline):
        prev = json.load(open(args.baseline, encoding='utf-8'))
        p_agg = prev.get('aggregate', {})
        delta_probe = round(agg['probe_mean'] - p_agg.get('probe_mean', 0), 3)
        delta_cc    = round(agg['call_chain_mean'] - p_agg.get('call_chain_mean', 0), 3)
        print()
        print(f'baseline 대비: probe {delta_probe:+.3f}, call_chain {delta_cc:+.3f}')

    perfect = agg['probe_mean'] == 1.0 and agg['call_chain_mean'] == 1.0
    sys.exit(0 if perfect else 1)


if __name__ == '__main__':
    main()
