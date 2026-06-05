---
sch-id: SCH-PRD-015
table: prd_prd_m
domain: product
domain-code: PRD
inf: []
---

# SCH-PRD-015: prd_prd_m

> **FUNC-ID:** [TBD] | **SRS-F:** [TBD] | **API:** [TBD] | **화면:** [TBD]

**근거 소스:** `sch_draft`

### 컬럼 설명
| 컬럼명 | 타입 | NULL | 기본값 | 설명 |
|--------|------|------|--------|------|
| CPCM_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| CPCM_SEQ | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| DLR_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| INSTPR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| INST_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| MDFPR_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| MDF_DTM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| MNL_ARC_CMMT
									, '&lt;'
									, '<')
								, '&gt;'
								, '>')
							, '&amp;'
							, '&')
						, '&nbsp;'
						, '')
					, '↵'
					, '')
				, '<[^>]*>'
				, '')
			, CHR(10)
			, DECODE(#{IS_NEW}, NULL, '', ''))
		, 4000
		, 1) AS CPCM_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_ID | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRD_NM | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRFR_RN | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRS_COST | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRS_PC | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |
| PRS_VAT_AMT | <!-- LLM-TODO --> | ? | — | <!-- LLM-TODO --> |

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
    prd_prd_m {
        COL CPCM_NM
        COL CPCM_SEQ
        COL DLR_ID
        COL DLR_NM
        COL INSTPR_ID
        COL INST_DTM
        COL MDFPR_ID
        COL MDF_DTM
        COL MNL_ARC_CMMT
									, '&lt;'
									, '<')
								, '&gt;'
								, '>')
							, '&amp;'
							, '&')
						, '&nbsp;'
						, '')
					, '↵'
					, '')
				, '<[^>]*>'
				, '')
			, CHR(10)
			, DECODE(#{IS_NEW}, NULL, '', ''))
		, 4000
		, 1) AS CPCM_NM
        COL PRD_ID
        COL PRD_NM
        COL PRFR_RN
        COL PRS_COST
        COL PRS_PC
        COL PRS_VAT_AMT
    }
```

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
