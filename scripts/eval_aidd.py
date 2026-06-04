# STATUS: 완료
#!/usr/bin/env python3
"""
eval_aidd.py — AIDD 결과 품질 A/B 비교 하네스 (T3-B, 논문 H4) [반자동]

프로토콜: 동일 FUNC 집합을 두 조건으로 구현 →
  A. 풀 그라운딩(JIT: _asis_brief + 실소스 read)
  B. 소스만(그라운딩 없음)
각 조건의 결과(테스트 통과/실패, 리뷰 결함 수)를 results JSON으로 기록 → 본 도구가 비교표 산출.

results JSON 포맷:
  {"variant":"A","funcs":[{"func":"FUNC-..","tests_pass":N,"tests_fail":M,"defects":K}, ...]}

Usage:
  python eval_aidd.py --a a_results.json --b b_results.json [--out report.md]
"""
import sys, json

def agg(path):
    d = json.load(open(path, encoding='utf-8'))
    funcs = d.get('funcs', [])
    tp = sum(f.get('tests_pass', 0) for f in funcs)
    tf = sum(f.get('tests_fail', 0) for f in funcs)
    df = sum(f.get('defects', 0) for f in funcs)
    n = len(funcs)
    pass_rate = tp / (tp + tf) if (tp + tf) else 0.0
    return {'variant': d.get('variant', '?'), 'funcs': n, 'tests_pass': tp,
            'tests_fail': tf, 'pass_rate': pass_rate, 'defects': df,
            'defects_per_func': (df / n if n else 0.0)}

def main():
    argv = sys.argv[1:]
    def opt(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default
    a_path, b_path = opt('--a'), opt('--b')
    if not a_path or not b_path:
        print('Usage: eval_aidd.py --a A.json --b B.json [--out report.md]')
        print('  A=풀 그라운딩(JIT), B=소스만. 각 FUNC tests_pass/tests_fail/defects 기록.')
        return 1
    A, B = agg(a_path), agg(b_path)
    lines = ['# AIDD 결과 A/B 비교 (H4)', '',
             '| 지표 | A: 풀 그라운딩(JIT) | B: 소스만 | 차이 |',
             '|------|--------------------|-----------|------|',
             f"| FUNC 수 | {A['funcs']} | {B['funcs']} | |",
             f"| 테스트 통과율 | {A['pass_rate']:.1%} | {B['pass_rate']:.1%} | {A['pass_rate']-B['pass_rate']:+.1%} |",
             f"| FUNC당 결함 | {A['defects_per_func']:.2f} | {B['defects_per_func']:.2f} | {A['defects_per_func']-B['defects_per_func']:+.2f} |",
             '',
             '> H4: 풀 그라운딩이 소스만 대비 통과율↑·결함↓이면 JIT 그라운딩의 AIDD 효능 입증.',
             '> 독립 오라클(실제 테스트 실행 + 별도 리뷰)을 정답으로 — qa-agent(스펙 오라클) 순환 회피.']
    out = '\n'.join(lines)
    op = opt('--out')
    if op:
        open(op, 'w', encoding='utf-8').write(out + '\n')
        print(f'리포트: {op}')
    print(out)
    return 0

if __name__ == '__main__':
    sys.exit(main())
