# STATUS: 완료
#!/usr/bin/env python3
"""
build_domain_overview.py — 도메인 SOP 내러티브 레이어 생성 (T4-B, 신규자/신규요건 분석용)

기계 인덱스(frontmatter/앵커)와 분리된 **사람용 개요**를 생성한다(이중 레이어 명시 분리, 결함 #6/#10).
도메인별: 목적 + 핵심 엔티티(테이블 사용빈도) + 대표 기능(진입 엔드포인트) + 신규자 진입점.
출력: docs/05_설계서/{도메인}/OVERVIEW_{도메인}.md  (zero-LLM, 그래프 기반)

Usage: python build_domain_overview.py [workspace] [domain_filter]
"""
import os, sys, json
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

def _domain_desc(root):
    p = os.path.join(root, 'docs/05_설계서/_domain_plan.json')
    try:
        plan = json.load(open(p, encoding='utf-8'))
        return {d['name']: d.get('description', '') for d in plan.get('domains', [])}
    except Exception:
        return {}

def generate(root, domain_filter=None):
    graph = sgb.build_graph(root)
    descs = _domain_desc(root)
    # 도메인별 INF 그룹
    by_dom = {}
    for iid, n in graph['inf'].items():
        by_dom.setdefault(n.get('domain') or '?', []).append((iid, n))
    count = 0
    for domain, infs in by_dom.items():
        if domain_filter and domain != domain_filter:
            continue
        # 핵심 엔티티 = 도메인 내 INF에서 가장 많이 쓰인 테이블
        tbl_freq = Counter()
        for _, n in infs:
            for t in n.get('tables', []):
                tbl_freq[t] += 1
        core = tbl_freq.most_common(8)
        # 대표 기능 = 엔드포인트 (path 알파벳순 상위)
        reps = sorted(infs, key=lambda x: (x[1].get('path') or ''))[:12]
        lines = [f'# {domain} 도메인 개요 (신규자·신규요건 분석용)', '',
                 '> 사람용 SOP 레이어. 기계용 인덱스(INF/SCH frontmatter·앵커)와 분리된 개념 설명이다.', '',
                 '## 목적', descs.get(domain) or '(도메인 설명 미정 — _domain_plan.json description 보완 권장)', '',
                 '## 핵심 엔티티 (사용 빈도순 — 이 테이블부터 이해)', '']
        if core:
            for t, c in core:
                schs = graph['table_to_sch'].get(t, [])
                ref = f' → {schs[0]}' if schs else ''
                lines.append(f'- **{t}** ({c}개 기능에서 사용){ref}')
        else:
            lines.append('- (테이블 정보 없음)')
        lines += ['', f'## 대표 기능 ({len(infs)}개 중 진입점)', '']
        for iid, n in reps:
            lines.append(f"- {n.get('method','')} `{n.get('path','')}` — [{iid}](INF/{iid}.md)")
        lines += ['', '## 신규자 진입점',
                  f'1. 위 **핵심 엔티티** 상위 2~3개의 SCH(DB_{domain}.md)로 데이터 구조 파악',
                  '2. **대표 기능**의 INF 1~2개를 열어 요청/응답·비즈니스 규칙 확인',
                  '3. 변경 작업 시 `/sl-change`가 영향슬라이스+소스앵커로 정밀 그라운딩을 제공',
                  f'4. 화면은 UIS, 전체 DB는 DB_{domain}.md 참조', '']
        out_dir = os.path.join(root, 'docs/05_설계서', domain)
        os.makedirs(out_dir, exist_ok=True)
        open(os.path.join(out_dir, f'OVERVIEW_{domain}.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
        count += 1
        print(f'{domain}: 개요 생성 (INF {len(infs)}, 핵심테이블 {len(core)})')
    return count

def main():
    argv = [a for a in sys.argv[1:]]
    root = argv[0] if argv and not argv[0].startswith('--') else '.'
    dom = argv[1] if len(argv) > 1 and not argv[1].startswith('--') else None
    n = generate(root, dom)
    print(f'완료: 도메인 개요 {n}개')
    return 0

if __name__ == '__main__':
    sys.exit(main())
