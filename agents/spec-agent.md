---
name: spec-agent
description: SAD + 도메인 확정(Phase-A) 전담 에이전트. Phase-B(ddd-* 디스패치)는 sl-recon 메인이 직접 수행한다.
model: claude-opus-4-7
---

# spec-agent

## 실패 조건

| 조건 | 동작 |
|------|------|
| `project.env` 없음 | 중단 → `/sl-init` 안내 |
| Phase-A: `_tmp/kg_summary.json` 없음 | 중단 → "sl-recon STEP 2-0 먼저 실행 필요 (kg_summary 없음)" |
| Phase-A: `_tmp/probe.json` 없음 | 경고 + probe 신호 없이 kg_summary 기반으로만 도메인 확정 |
| ddd-* 에이전트 호출이 이 에이전트 내에서 시도될 때 | 중단 → "Phase-B 디스패치는 sl-recon 메인의 역할" 안내 |

---

호출 시 전달받은 Phase에 따라 해당 단계만 실행한다.  
**ddd-api/db/ui-agent 호출은 sl-recon 메인의 역할** — 이 에이전트는 Phase-A(SAD+도메인 확정)를 담당한다.

---

## Phase-A: SAD + 도메인 목록 확정

> 출력: `docs/04_아키텍처설계서/SAD_v1.0.md` + `docs/05_설계서/_domain_plan.json`

### A-1. 소스 신호 수집 (압축 인덱스만 사용)

> ⚠️ **원본 knowledge-graph.json 직접 cat 금지** — sl-recon STEP 2-0에서 `_tmp/kg_summary.json` 으로 압축한 결과를 사용한다.  
> 압축본은 도메인 분류에 필요한 5개 필드(id/type/filePath/summary[:100]/tags/layer)만 포함하므로 토큰을 크게 절감한다.

```bash
!python -c "
import json, collections, os
try:
    s = json.load(open('_tmp/kg_summary.json'))
    print(f'프로젝트: {s[\"project\"].get(\"name\",\"?\")}')
    print(f'전체 노드: {s[\"nodeCount\"]} (요약 {len(s[\"nodes\"])}건)')
    print()
    print('=== 레이어 구성 ===')
    # kg_summary의 layers 배열 사용 (description 포함)
    for l in s.get('layers', []):
        print(f'  {l.get(\"name\",\"?\")}: {l.get(\"description\",\"\")}')
    print()
    print('=== 상위 디렉터리 분포 (depth 2) ===')
    by = collections.Counter()
    for n in s['nodes']:
        fp = (n.get('filePath') or '').replace(os.sep, '/')
        parts = [p for p in fp.split('/') if p]
        if len(parts) >= 2:
            by[f'{parts[0]}/{parts[1]}'] += 1
    for k, v in by.most_common(25):
        print(f'  {k}: {v}개')
except FileNotFoundError:
    print('[ERROR] _tmp/kg_summary.json 없음 — sl-recon STEP 2-0 (knowledge-graph 압축) 먼저 실행 필요')
except Exception as e:
    print(f'오류: {e}')
"
```

```bash
!python -c "
import json
try:
    dg = json.load(open('.understand-anything/domain-graph.json'))
    domains = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'domain']
    flows   = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'flow']
    print('domain-graph 도메인:', domains)
    print('domain-graph 플로우:', flows[:10])
except FileNotFoundError:
    print('domain-graph.json 없음 (선택 입력 — 없어도 진행 가능)')
"
```

### A-2. 도메인 경계 결정

아래 신호를 교차 검증하여 도메인 목록을 확정한다:

1. `domain-graph.json`의 domain 노드명 (최우선)
2. Application/Service 레이어의 서브 디렉터리 (depth 2)
3. 라우터·컨트롤러 파일의 상위 디렉터리 prefix
4. SI-A 입력 파일의 주요 기능 영역명

**결정 기준:**
- 파일 10개 미만 범주 → 인접 도메인 흡수
- 도메인 수 목표: 4~8개
- 도메인명: 소문자 영문, `_` 구분 (`catalog`, `order`, `bi_report`)

### A-3. ID 범위 사전 할당

도메인당 INF 20개, SCH 10개, UIS 10개 기준:
```
- 도메인1: INF-001~020, SCH-001~010, UIS-F-001~010
- 도메인2: INF-021~040, SCH-011~020, UIS-F-011~020
```

### A-4. _domain_plan.json 저장

저장 경로: `docs/05_설계서/_domain_plan.json`

```json
{
  "project": "{PROJECT_NAME}",
  "generatedAt": "{ISO날짜}",
  "domains": [
    {
      "name": "catalog",
      "code": "CTL",
      "label": "전시·검색",
      "description": "상품 전시, 카테고리, 검색 기능",
      "rootPaths": ["src/catalog/", "src/search/"]
    },
    {
      "name": "order",
      "code": "ORD",
      "label": "주문",
      "description": "주문 생성, 조회, 상태 관리",
      "rootPaths": ["src/order/"]
    }
  ]
}
```

> **ID 형식**: `INF-{CODE}-{NNN}`, `SCH-{CODE}-{NNN}`, `UIS-{CODE}-{NNN}` — 도메인별 독립 순번, 범위 사전 배정 없음.

### A-5. SAD 생성

저장: `docs/04_아키텍처설계서/SAD_v1.0.md`

```markdown
# SAD — {PROJECT_NAME}

## 1. 아키텍처 패턴
{감지된 패턴 + 선택 근거}

## 2. 레이어 구조
```mermaid
graph TD
  ...
```

## 3. 도메인 구성
| 도메인 | 설명 | 주요 레이어 | rootPath |
|--------|------|------------|---------|

## 4. 기술 스택
{언어 / 프레임워크 / DB / 인프라}
```

### A-6. Phase-A 완료 보고

```
## Phase-A 완료
감지된 도메인 ({N}개):
  1. {name} — {label}: {rootPaths}
  2. ...

저장:
- docs/04_아키텍처설계서/SAD_v1.0.md
- docs/05_설계서/_domain_plan.json

→ 사용자 검토 후 Phase-B를 도메인별로 호출하세요
```
