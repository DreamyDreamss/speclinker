---
sch-id: SCH-PRD-008
table: prd_dlr_m
domain: product
domain-code: PRD
inf: []
---

# SCH-PRD-008: prd_dlr_m

> **FUNC-ID:** [TBD] | **SRS-F:** [TBD] | **API:** [TBD] | **화면:** [TBD]

**근거 소스:** `sch_draft`

### 컬럼 설명
| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| BSCN_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CODE_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| COUNT(*) | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_1_CMMT | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_2_CMMT | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_ARC_AP_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_ARC_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_CLSF_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_CTGR_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_INFO_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_INPUT_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_INPUT_YN | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_SIGN_MTD_TP_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CTR_TP_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DECODE(GRNT_INSR_EXMP_YN, 'Y', 'Y'
			, DECODE(GRNT_INSR_STS_CD, '10', 'Y', 'N')
		) AS GRNT_INSR | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLG_DLR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLG_PRD_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_DEAL_STS_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_FLFM_GRNT_INSR_CNN | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_AD_BGN_DATE | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_AD_CL_DATE | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_BRNO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_DLR_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_DLR_CD_3 | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_DLR_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_DLR_NM_3 | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_MD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DRAFT_MD_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| INSTPR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| INST_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| MDFPR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| MDF_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_APP_STS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_CLSF_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_DCLS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_PRS_CNSL_DRFT_NO | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_PRS_CNSL_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_STS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| SHOP_FLFM_GRNT_INSR_CNN | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| SL_STS_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| SORT_ORDR | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| STDR_DEAL_CTR_STS_CD | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| USE_YN | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |

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
    prd_dlr_m {
        COL BSCN_NM
        COL CODE_NM
        COL COUNT(*)
        COL CTR_1_CMMT
        COL CTR_2_CMMT
        COL CTR_ARC_AP_TP_CD
        COL CTR_ARC_TP_CD
        COL CTR_CLSF_CD
        COL CTR_CTGR_TP_CD
        COL CTR_INFO_TP_CD
        COL CTR_INPUT_TP_CD
        COL CTR_INPUT_YN
        COL CTR_SIGN_MTD_TP_CD
        COL CTR_TP_NM
        COL DECODE(GRNT_INSR_EXMP_YN, 'Y', 'Y'
			, DECODE(GRNT_INSR_STS_CD, '10', 'Y', 'N')
		) AS GRNT_INSR
        COL DLG_DLR_ID
        COL DLG_PRD_NM
        COL DLR_DEAL_STS_CD
        COL DLR_FLFM_GRNT_INSR_CNN
        COL DLR_ID
        COL DLR_NM
        COL DRAFT_AD_BGN_DATE
        COL DRAFT_AD_CL_DATE
        COL DRAFT_BRNO
        COL DRAFT_DLR_CD
        COL DRAFT_DLR_CD_3
        COL DRAFT_DLR_NM
        COL DRAFT_DLR_NM_3
        COL DRAFT_MD_ID
        COL DRAFT_MD_NM
    }
```

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
