"""
tests/run_smoke.py
Phase 0 회귀 검증 — probe.py + resolve_call_chain.py가
각 스택 fixture에서 의도대로 동작하는지 확인.

각 tests/smoke/<fixture>/expected.json 의 expectation을 기준으로 검증.

사용법:
  python3 tests/run_smoke.py
  python3 tests/run_smoke.py --fixture spring-mybatis-ntier   # 단일 fixture
  python3 tests/run_smoke.py --verbose
"""
import os
import sys
import json
import argparse
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT, 'scripts')
SMOKE_DIR   = os.path.join(ROOT, 'tests', 'smoke')

# scripts 디렉토리를 import 가능하게
sys.path.insert(0, SCRIPTS_DIR)

import probe                           # noqa: E402
import resolve_call_chain as rcc       # noqa: E402


# ────────────────────────────────────────────────────────────
# 검증 헬퍼
# ────────────────────────────────────────────────────────────

class AssertFail(Exception):
    pass


def _assert(cond, msg):
    if not cond:
        raise AssertFail(msg)


def check_probe(fixture_dir: str, exp: dict, verbose: bool):
    """probe.py 실행 → indicators 검증"""
    result = probe.probe(fixture_dir)
    ind = result['indicators']
    e = exp.get('probe_expectations', {})

    if 'likely_backend_lang' in e:
        _assert(ind['likely_backend_lang'] == e['likely_backend_lang'],
                f"backend_lang: expected {e['likely_backend_lang']} got {ind['likely_backend_lang']}")
    if 'likely_backend_framework' in e:
        _assert(ind['likely_backend_framework'] == e['likely_backend_framework'],
                f"backend_framework: expected {e['likely_backend_framework']} got {ind['likely_backend_framework']}")
    if 'likely_persistence_contains' in e:
        _assert(e['likely_persistence_contains'] in (ind['likely_persistence'] or []),
                f"persistence: expected to contain {e['likely_persistence_contains']} got {ind['likely_persistence']}")
    if 'likely_frontend_framework' in e:
        _assert(ind['likely_frontend_framework'] == e['likely_frontend_framework'],
                f"frontend_framework: expected {e['likely_frontend_framework']} got {ind['likely_frontend_framework']}")
    if 'architecture_hint_contains' in e:
        target = e['architecture_hint_contains']
        hits = [h for h in ind['architecture_hints'] if target in h]
        _assert(hits, f"architecture_hints: expected to contain '{target}' got {ind['architecture_hints']}")

    if verbose:
        print(f'    probe indicators: lang={ind["likely_backend_lang"]} fw={ind["likely_backend_framework"]} '
              f'per={ind["likely_persistence"]} arch={ind["architecture_hints"]}')


def check_call_chain(fixture_dir: str, exp: dict, verbose: bool):
    """resolve_call_chain.py 실행 → controller부터 traverse 결과 검증"""
    e = exp.get('call_chain_expectations')
    if not e:
        return
    controller = os.path.join(fixture_dir, e['controller'].replace('/', os.sep))
    _assert(os.path.exists(controller), f"controller 파일 없음: {controller}")

    chain = rcc.resolve_chain(controller, fixture_dir)

    def norm_set(paths):
        return {p.replace('\\', '/').lower() for p in paths}

    services = norm_set(chain.get('service') or [])
    daos     = norm_set(chain.get('dao') or [])
    queries  = norm_set(chain.get('query') or [])
    all_resolved = services | daos | queries

    if 'service_must_resolve_to' in e:
        target = e['service_must_resolve_to'].lower()
        _assert(any(s.endswith(target) for s in all_resolved),
                f"service traverse 실패: expected to find '{target}' in {sorted(all_resolved)}")
    if 'dao_must_resolve_to' in e:
        target = e['dao_must_resolve_to'].lower()
        _assert(any(s.endswith(target) for s in all_resolved),
                f"dao traverse 실패: expected to find '{target}' in {sorted(all_resolved)}")
    if 'query_must_resolve_to' in e:
        target = e['query_must_resolve_to'].lower()
        _assert(any(q.endswith(target) for q in queries),
                f"query traverse 실패: expected to find '{target}' in {sorted(queries)}")
    if 'domain_must_resolve_to' in e:
        target = e['domain_must_resolve_to'].lower()
        _assert(any(s.endswith(target) for s in all_resolved),
                f"domain traverse 실패 (Phase 0.1 핵심 검증): expected '{target}' in {sorted(all_resolved)}")

    if verbose:
        print(f'    chain: service={len(services)} dao={len(daos)} query={len(queries)}')
        for s in sorted(all_resolved):
            print(f'      → {s}')


# ────────────────────────────────────────────────────────────
# 메인 루프
# ────────────────────────────────────────────────────────────

def run_fixture(name: str, verbose: bool) -> tuple:
    fixture_dir = os.path.join(SMOKE_DIR, name)
    exp_path = os.path.join(fixture_dir, 'expected.json')
    if not os.path.exists(exp_path):
        return (name, False, 'expected.json 없음')
    exp = json.load(open(exp_path, encoding='utf-8'))

    try:
        check_probe(fixture_dir, exp, verbose)
        check_call_chain(fixture_dir, exp, verbose)
    except AssertFail as e:
        return (name, False, str(e))
    except Exception as e:
        return (name, False, f'예외: {type(e).__name__}: {e}')
    return (name, True, '')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', default='', help='단일 fixture만 실행')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if not os.path.isdir(SMOKE_DIR):
        print(f'smoke 디렉토리 없음: {SMOKE_DIR}')
        sys.exit(2)

    fixtures = sorted(
        d for d in os.listdir(SMOKE_DIR)
        if os.path.isdir(os.path.join(SMOKE_DIR, d))
    )
    if args.fixture:
        fixtures = [args.fixture]

    print(f'Phase 0 회귀 검증 — fixture {len(fixtures)}종\n')
    results = []
    for name in fixtures:
        print(f'  [{name}]')
        result = run_fixture(name, args.verbose)
        results.append(result)
        _, ok, msg = result
        print(f'    {"OK" if ok else "FAIL"}{": " + msg if msg else ""}\n')

    pass_count = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f'\n=== {pass_count}/{total} 통과 ===')
    sys.exit(0 if pass_count == total else 1)


if __name__ == '__main__':
    main()
