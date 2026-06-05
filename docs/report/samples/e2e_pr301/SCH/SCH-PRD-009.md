---
sch-id: SCH-PRD-009
table: prd_isd_app_d
domain: product
domain-code: PRD
inf: []
---

# SCH-PRD-009: prd_isd_app_d

> **FUNC-ID:** [TBD] | **SRS-F:** [TBD] | **API:** [TBD] | **화면:** [TBD]

**근거 소스:** `sch_draft`

### 컬럼 설명
| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| (
		SELECT DEPT_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| APPLN_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| APPLN_SEQ | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| APP_SEQ | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| BRNO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CNSL_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_BGN_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_CL_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_CTGR_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_DG | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_NO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_PGS_STS_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_SIGN_MTD_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DEPT_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ISD_APPR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ISD_APPR_ID) | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ISD_APP_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ISD_APP_NO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ISD_APP_ORDR | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_PC_SEQ | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_PRS_CNSL_DRFT_NO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_PRS_CNSL_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| ROW_ORDR | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| SL_MDA_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| USR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| USR_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |

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
    prd_isd_app_d {
        COL (
		SELECT DEPT_NM
        COL APPLN_ID
        COL APPLN_SEQ
        COL APP_SEQ
        COL BRNO
        COL CNSL_TP_CD
        COL CTR_BGN_DTM
        COL CTR_CL_DTM
        COL CTR_CTGR_TP_CD
        COL CTR_DG
        COL CTR_NO
        COL CTR_PGS_STS_CD
        COL CTR_SIGN_MTD_TP_CD
        COL DEPT_ID
        COL DLR_ID
        COL DLR_NM
        COL ISD_APPR_ID
        COL ISD_APPR_ID)
        COL ISD_APP_DTM
        COL ISD_APP_NO
        COL ISD_APP_ORDR
        COL PRD_ID
        COL PRD_PC_SEQ
        COL PRD_PRS_CNSL_DRFT_NO
        COL PRD_PRS_CNSL_NM
        COL ROW_ORDR
        COL SL_MDA_TP_CD
        COL USR_ID
        COL USR_NM
    }
```

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
