---
name: sl-recon-doc
description: RECON Phase-3 — FUNC/SRS/RTM/IA맵 생성 (STEP 9~11). /sl-recon-uis 완료 후 실행.
triggers:
  - /sl-recon-doc
---

# /sl-recon-doc — 문서 색인 + RTM 생성

## 실행 전 확인

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, glob
errors = []
cp = '_tmp/recon_checkpoint.json'
if not os.path.exists(cp):
    errors.append('[FAIL] recon_checkpoint.json 없음 — /sl-recon 먼저 실행')
inf_files = glob.glob('docs/05_설계서/*/INF/INF-*.md')
if not inf_files:
    errors.append('[FAIL] INF 파일 없음 — /sl-recon 먼저 실행 (STEP 4-3에서 INF 생성)')
# 화면(UIS) 전제: 현행 {도메인}/UIS/{화면}/spec.md (구버전 UI/ 하위호환)
uis_files = glob.glob('docs/05_설계서/*/UIS/*/spec.md') + glob.glob('docs/05_설계서/*/UI/*/spec.md')
if not uis_files:
    errors.append('[FAIL] UIS spec.md 없음 — /sl-recon-uis 먼저 실행')
if errors:
    for e in errors: print(e)
    sys.exit(1)
print(f'[OK] INF {len(inf_files)}개 | UIS 화면 {len(uis_files)}개 확인. 문서 색인 생성 진행')
"
```

---

## STEP 9 — Phase-C: 색인 + FUNC 생성 + FUNC_MAP

모든 Phase-B 완료 후 스크립트 + 에이전트를 순서대로 실행한다.

**9-0. 통합 인덱스 빌드 (rd/srs/rtm 공유용 — LLM 호출 없음)** — `scripts/build_funcs_index.py` 실행:

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_funcs_index.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('build_funcs_index.py 없음 — PLUGIN_PATH 확인')
"
```

생성된 `_tmp/funcs_index.json`은 9-2(rd-agent), 9-3(srs-agent), 9-4(rtm-agent) 세 에이전트가 공유한다.  
**동일한 spec.md/INF/*.md를 3번 cat하지 않도록 각 에이전트는 이 인덱스를 1차 입력으로 사용한다.**

> (v3.12 정리) 구 STEP 9-0-1 `build_si_graph.py`(si-graph.json)는 소비처가 없어 제거됨.
> 스펙→소스 추적은 INF frontmatter `anchors:` + SpecLens `spec_index`가 대체한다.

---

**9-1. 전체 색인 생성 (스크립트, LLM 호출 없음)** — `scripts/merge_index.py` 실행:

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'merge_index.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('merge_index.py 없음 — PLUGIN_PATH 확인')
"
```

도메인별 INF/SCH/UIS 파일을 스캔해서 색인 3종(API_Design.md, DB_Schema.md, UI_Spec_v1.0.md)을 자동 생성한다.  
색인은 merge_index.py가 자동 생성한다 (spec-agent 호출 없음).

**9-2. FUNC 생성** — `agents/rd-agent.md`를 서브에이전트로 실행 (RECON 모드, **Haiku** — v3.24):

```
Agent 도구 호출:
  subagent_type: "speclinker:rd-agent"
  model: "haiku"      ← v3.24 토큰절감 (인덱스 → 마크다운 포맷팅, 기계적 작업)
  description: "RECON: FUNC_v1.0.md 생성"
  prompt: |
    RECON 모드.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다 (spec.md/INF cat 금지).
    `docs/00_FUNC/FUNC_v1.0.md`와 `docs/00_FUNC/domains/FUNC_{도메인}.md`를 생성하라.
    FUNC-{도메인}-{NNN} ID 체계. 구현 사실만 기록.

    Screen-first 신호 활용 (funcs_index.json 내):
    - screens 섹션: 각 UIS-F-XXX의 screen_name·route·api_hints 목록
    - infs 섹션: 각 INF의 used_by_screens 필드 (어느 화면이 이 INF를 호출하는지)
    - 화면 단위로 FUNC를 구성한다 (화면 1개 = 1~3 FUNC 목표).
      예: UIS-F-001 주문목록 → FUNC-order-001(주문 목록 조회), FUNC-order-002(주문 상태 필터)

    결과 반환: "✅ FUNC {N}개 생성완료 (FUNC_MAP.md, 도메인별 파일)" 1줄만.
```

**9-3. SRS 생성** — `agents/srs-agent.md`를 서브에이전트로 실행 (RECON 모드, **Sonnet**):

> **Phase 7.7 변경**: SRS-F를 도메인 단위가 아닌 **화면(UIS) 단위 use-case**로 생성한다.  
> 화면 1개 = SRS-F 1개가 원칙. 복잡한 다탭 화면은 최대 2~3개로 분리 허용.

```
Agent 도구 호출:
  subagent_type: "speclinker:srs-agent"
  model: "sonnet"      ← RECON 다운그레이드 (사실 집계 위주, Reflexion은 자체 검증)
  description: "RECON: SRS_v1.0.md 생성 (화면별 use-case)"
  prompt: |
    RECON 모드 — Screen-first SRS.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.

    SRS-F 생성 단위: **각 화면(UIS-F-XXX) = use-case 1개** (도메인 집계 아님).
    화면 순서대로 SRS-F-NNN을 배정한다.

    SRS는 사용자(PM·고객·QA)용 업무 명세 뷰잉 문서다. **합성형 6섹션**(srs-agent 정의):
    ① 기능 요약(업무 서사 3~5줄) ② 업무 흐름(화면 가로지른 단일 시나리오)
    ③ 비즈니스 규칙 종합(INF 규칙+SCH 코드값+UIS §5, 출처 표기) ④ 예외·제약
    ⑤ 연관 산출물(funcs_index 기계 조립: UIS/INF/SCH 링크) ⑥ 데이터 영향(CRUD 테이블)

    **토큰 원칙(MUST)**: LLM은 ①②③④(종합·해설)에만. ⑤⑥은 funcs_index 사실 조립(추론 금지).
    UIS §2/§5/§6 복붙 금지 — 업무 서사로 재구성. FUNC-ID 역방향 연결.

    Reflexion 자기검증 루프(최대 2회).
    출력:
    - `docs/03_기능명세서/SRS_v1.0.md`
      (색인표: `| SRS-F-XXX | 화면명 | UIS-ID | 호출 INF | FUNC-ID |`)
    - `docs/03_기능명세서/domains/SRS_{도메인}.md` × 도메인 수
      (각 도메인 파일에는 해당 도메인 화면들의 SRS-F만 포함)

    결과 반환: "✅ SRS-F {N}개 생성완료 (SRS_v1.0.md)" 1줄만.
```

**9-4. FUNC_MAP 생성** — `agents/rtm-agent.md`를 서브에이전트로 실행 (RECON 모드, **Opus 유지**):

> **Phase 7.7 변경**: FUNC_MAP을 **화면(UIS) → SRS → INF → SCH** 4단 체인 매트릭스로 생성한다.  
> INF의 `used_by_screens` 필드를 역참조하여 화면↔INF 연결을 사실 기반으로 확정한다.

```
Agent 도구 호출:
  subagent_type: "speclinker:rtm-agent"
  ← model 미지정 (frontmatter의 opus 유지 — Constitutional 6원칙 검증 필요)
  description: "RECON: FUNC_MAP.md 생성 (화면→SRS→INF→SCH 매트릭스)"
  prompt: |
    RECON 모드 — Screen-first FUNC_MAP.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.

    FUNC_MAP 행 단위: **화면 1개 = 1행** (도메인 집계 아님).
    컬럼 구성:
    | UIS-ID | 화면명 | Route | SRS-F | FUNC-ID | 호출 INF 목록 | 연관 SCH |

    데이터 소스 우선순위:
    1. funcs_index `infs[].used_by_screens`(INF frontmatter `screens:` 기반) → 화면↔INF 연결 (사실 기반, 최우선)
    2. UIS spec.md의 `api_hints` → INF가 없는 URL 보완
    3. SRS_v1.0.md의 SRS-F↔UIS-ID 매핑 → SRS 컬럼
    4. INF↔SCH 연결은 funcs_index `infs[].sch_ids`(SCH frontmatter `inf:` 역인덱스, 사실 기반). 보조로 INF frontmatter `tables:`

    출력: `docs/00_FUNC/FUNC_MAP.md`

    결과 반환: "✅ FUNC_MAP {N}행 생성완료, linked-func-cache 저장" 1줄만.
```

```bash
!ls docs/00_FUNC/ 2>/dev/null \
  && echo "FUNC 생성 완료" \
  || echo "00_FUNC 없음 — rd-agent(RECON) 실패 확인 필요"
!ls docs/03_기능명세서/domains/ 2>/dev/null \
  && echo "SRS 생성 완료" \
  || echo "03_기능명세서 없음 — srs-agent 실패 확인 필요"
```

---

## STEP 9-5 — 도메인 SOP 개요 생성 (사람 내러티브 레이어, 4-5)

기계 인덱스(INF/SCH frontmatter·앵커)와 **분리된 사람용 개요**를 도메인별로 생성한다 — 신규입사자·신규요건 분석용.
목적·핵심 엔티티·대표 기능(코드의미 주입)·진입점. zero-LLM(그래프 기반).

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_domain_overview.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('build_domain_overview.py 없음 — PLUGIN_PATH 확인')
"
```

> 산출 `docs/05_설계서/{도메인}/OVERVIEW_{도메인}.md` = **사람 SOP 레이어**(개념·완전성 부담 면제). AI 그라운딩은 별도(앵커+소스 JIT).

## STEP 10 — IA 맵 생성 (별도 커맨드)

화면 계층(IA) 맵은 현행 **`/sl-ia`** 커맨드가 담당한다 — UIS `menu-path` + 화면↔INF 연결로
`docs/00_IA/IA_MAP.md`를 생성하고 UIS `menu-path`를 일괄 보완한다.
(SpecLens 뷰어의 [IA 트리]도 `gen_docsify.py`가 UIS `menu-path`로 만든 `spec_index.json`의 `ia_tree`를 그대로 보여준다.)

```bash
!echo "IA 맵은 /sl-ia 커맨드로 생성하세요 (이 STEP에서 자동 호출하지 않음)."
```

---

## STEP 11 — 완료 안내

완료 안내:
```
역분석 완료.

생성 파일:
[아키텍처]
- docs/04_아키텍처설계서/SAD_v1.0.md

[상세 설계]
- docs/05_설계서/{도메인}/INF/INF-XXX.md × N개  (인터페이스 개별 파일)
- docs/05_설계서/{도메인}/UIS/UIS-{CODE}-{NNN}_{화면명}/spec.md × N개  (화면설계서, 화면당 디렉토리)
- docs/05_설계서/{도메인}/SCH/SCH-XXX.md × N개  (DB 스키마 개별 파일)
- docs/05_설계서/{도메인}/DB_{도메인}.md  (슬림 도메인 개요: 도메인 ERD + 테이블 목록, DDL 없음)
- docs/05_설계서/{도메인}/BAT/BAT-XXX.md × N개  (배치 명세 — 배치 파일 존재 시)
- docs/05_설계서/API_Design.md / DB_Schema.md / UI_Spec_v1.0.md  (전체 색인, 파일 직링크)

[기능 명세]
- docs/00_FUNC/FUNC_v1.0.md             (구현 기능 목록 — RD 대체)
- docs/00_FUNC/FUNC_MAP.md              (화면→SRS→INF→DB 직결 매핑 — RTM 대체)
- docs/03_기능명세서/SRS_v1.0.md        (SRS 색인)
- docs/03_기능명세서/domains/SRS_{도메인}.md × N개

[IA 맵]
- /sl-ia 로 docs/00_IA/IA_MAP.md 생성 (선택) — SpecLens 뷰어 [IA 트리]에서도 확인 가능

다음 단계: /sl-ia (IA 맵, 선택) → /sl-viewer (SpecLens 확인) → /sl-aidd (코드 구현·수정 필요 시) 또는 납품
```

> **POC 모드 사용자 안내** (POC_MODE=true 였을 때):  
> `_domain_plan.json`은 POC 필터가 적용된 상태로 저장됨.  
> 전체 도메인으로 다시 돌리려면:
> 1. `_domain_plan.json.full.json` 파일이 있으면 `_domain_plan.json` 으로 복사
> 2. `project.env`의 `POC_DOMAINS=` 를 비우거나 `POC_MODE=false`
> 3. `/sl-recon` 재실행 → 전체 도메인 처리

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
if env.get('POC_MODE','false').lower() == 'true':
    plan = json.load(open('docs/05_설계서/_domain_plan.json'))
    poc = plan.get('_poc', {})
    if poc.get('enabled'):
        print('🧪 POC 모드로 실행 완료')
        print(f'  처리: {poc.get(\"kept\",[])}')
        print(f'  건너뜀: {poc.get(\"skipped\",[])}')
        backup = 'docs/05_설계서/_domain_plan.json.full.json'
        if os.path.exists(backup):
            print(f'  복원: cp {backup} docs/05_설계서/_domain_plan.json')
"
```

---

## RECON 완료

모든 산출물 생성이 완료됐습니다.

**최종 체크포인트:**
```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os, datetime
cp = json.load(open('_tmp/recon_checkpoint.json', encoding='utf-8')) if os.path.exists('_tmp/recon_checkpoint.json') else {}
import glob
cp.update({'phase': 'recon-complete', 'completed_at': datetime.datetime.now().isoformat(), 'status': 'ok'})
json.dump(cp, open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
screens = glob.glob('docs/05_설계서/*/UIS/*/spec.md') + glob.glob('docs/05_설계서/*/UI/*/spec.md')
print(f'RECON 완료: 화면 {len(screens)}개, 체크포인트 저장')
"
```
