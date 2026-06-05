---
sch-id: SCH-PRD-006
table: prd_brnd_m
domain: product
domain-code: PRD
inf: []
---

# SCH-PRD-006: prd_brnd_m

> **FUNC-ID:** [TBD] | **SRS-F:** [TBD] | **API:** [TBD] | **화면:** [TBD]

**근거 소스:** `sch_draft`

### 컬럼 설명
| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| DLG_PRD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_DCLS_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_DCLS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_LCLS_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_LCLS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_MCLS_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_MCLS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_SCLS_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_SCLS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_SP_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRS_CLSF_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRS_WAY_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| SRCNG_MDA_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |

### 인덱스
| 인덱스명 | 컬럼 | 타입 | 목적 |
|---------|------|------|------|
| — | — | — | — |

### 코드값
<!-- LLM-TODO: 코드성 컬럼(_CD/_TP/_STS/_YN 등) 값·의미. 없으면 섹션 생략 가능 -->

### 관계 (FK)
| 참조 컬럼 | 참조 테이블 | ON DELETE |
|---------|-----------|----------|
| — | — | — |

### mini-ERD
```mermaid
erDiagram
    prd_brnd_m {
        COL DLG_PRD_ID
        COL PRD_DCLS_ID
        COL PRD_DCLS_NM
        COL PRD_ID
        COL PRD_LCLS_ID
        COL PRD_LCLS_NM
        COL PRD_MCLS_ID
        COL PRD_MCLS_NM
        COL PRD_NM
        COL PRD_SCLS_ID
        COL PRD_SCLS_NM
        COL PRD_SP_TP_CD
        COL PRS_CLSF_CD
        COL PRS_WAY_TP_CD
        COL SRCNG_MDA_TP_CD
    }
```

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
