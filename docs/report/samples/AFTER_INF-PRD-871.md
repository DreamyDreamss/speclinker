---
inf-id: INF-PRD-871
method: POST
path: /app/product/appreg/pr303List
domain: product
domain-code: PRD
req-f: "[TBD]"
srs-f: "[TBD]"
screens: []
tables:
  - PRD_PRD_PRS_CNSL_M
  - PRD_DLR_M
  - PRD_MD_M
  - PRD_CTDC_CTL_M
  - JT_CODE
  - CMM_BO_USR_M
anchors:
  - nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/controller/Pr303Controller.java:81-109
  - nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/service/impl/PrdPrdPrsCnslMServiceImpl.java:2293-2303
  - nkshop-bos-admin/src/main/resources/sqlmapper/product/ctrcnslapp/PrdPrdPrsCnslMMapper.xml:1148-1248
---

# INF-PRD-871: POST /app/product/appreg/pr303List — 매입품의 결재 목록 조회

> **근거 소스:** `nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/controller/Pr303Controller.java:81-109`

> **앵커 규칙 (full-chain — 4-1):** 이 INF는 Controller → Service → Mapper SQL 전체 호출 체인을 추적합니다.
> 진입점(Controller `pr303List`), 비즈니스 로직(Service `findApprovalProgressList`), 
> 쿼리 실행(Mapper `selectApprovalProgressList`)의 세 단계 모두가 `anchors:` 배열에 기록됩니다.

## 요청

- Method: POST
- Path: /app/product/appreg/pr303List
- Content-Type: application/json

| 파라미터 | 위치 | 타입 | 필수 | 설명 |
|---------|------|------|------|------|
| jRowBounds | Body | object | Y | 페이징 정보 (jwork GridParameter) |
| 조회 조건 | Body | object | N | SCH_FROM_INST_DTM, SCH_TO_INST_DTM, SCH_MD_ID, SCH_PRD_ID, SCH_CTR_CLSF_CD 등 |

## 응답 (200 OK)

```json
{
  "records": [
    {
      "PRD_PRS_CNSL_DRFT_NO": "상품매입품의기안번호",
      "CTR_CTGR_TP_CD": "계약카테고리구분코드",
      "PRD_PRS_CNSL_NM": "상품매입품의명",
      "CNSL_TP_CD": "품의구분코드",
      "CNSL_TP_NM": "품의구분명",
      "CTR_CLSF_CD": "계약유형코드",
      "CTR_CLSF_NM": "계약유형명",
      "CTR_APP_TP_CD": "결재상태코드",
      "APP_STS_NM": "결재상태명",
      "MD_ID": "MD_ID",
      "MD_NM": "MD명",
      "DLR_ID": "협력사ID",
      "DLR_NM": "협력사명",
      "RMK": "비고",
      "DEL_DTM": "YYYY-MM-DD",
      "DEL_YN": "Y|N",
      "PRS_CNSL_APP_NO": "매입품의결재번호",
      "PC_CHG_YN": "가격변경여부",
      "COMP_CHG_YN": "구성변경여부",
      "PMT_CHG_YN": "프로모션변경여부",
      "BRD_TIME_ADD_YN": "방송시간추가여부",
      "DLR_CHG_YN": "협력사변경여부",
      "ETC_CHG_YN": "기타변경여부",
      "DFCT_FLFM_GRNT_INSR_EXMP_YN": "하자이행보증보험면제여부",
      "PAYM_FLFM_GRNT_INSR_EXMP_YN": "지급이행보증보험면제여부",
      "DFCT_FLFM_GRNT_INSR_ATT_FL_ID": "하자이행보증보험첨부파일ID",
      "PAYM_FLFM_GRNT_INSR_ATT_FL_ID": "지급이행보증보험첨부파일ID",
      "CTR_ETC_MTR_CNN": "계약기타사항내용",
      "ELTR_CTR_NO": "전자계약번호",
      "ELTR_CTR_DG": "전자계약차수",
      "ORG_ELTR_CTR_NO": "원전자계약번호",
      "ORG_ELTR_CTR_DG": "원전자계약차수",
      "KIMS_DRFT_NO": "KIMS기안번호",
      "KIMS_DST_YN": "KIMS발송여부",
      "KIMS_DST_DTM": "YYYY-MM-DD",
      "PRD_PLN_PP_ATT_FL_ID": "상품기획서첨부파일ID",
      "CTR_NDLS_YN": "계약불필요여부",
      "APPR_INQ_YN": "결재자조회여부",
      "CTR_BGN_DTM": "YYYY-MM-DD",
      "CTR_CL_DTM": "YYYY-MM-DD",
      "INST_DTM": "YYYY-MM-DD",
      "INSTPR_ID": "등록자ID",
      "INSTPR_NM": "등록자명",
      "MDF_DTM": "YYYY-MM-DD",
      "MDFPR_ID": "수정자ID",
      "CTR_PGS_STS_CD": "계약진행상태코드",
      "CTR_PGS_STS_NM": "계약진행상태명"
    }
  ],
  "total": "전체 건수",
  "page": "현재 페이지",
  "KIMS_APPROVAL_VIEW_URL": "KIMS 기안서보기 URL",
  "SRM_CONTRACT_VIEW_URL": "SRM 계약서보기 URL"
}
```

## 비즈니스 규칙

- 로그인한 사용자가 SYSADMIN 권한을 가지고 있으면 전체 결재 목록을 조회할 수 있음 (관리자)
- SYSADMIN이 아니면 결재선에 포함된 항목만 조회 가능
- 삭제 여부(DEL_YN) = 'N'인 항목만 조회
- 결재 상태(CTR_APP_TP_CD) = '10' (결재 중)
- 결재자 조회 여부(APPR_INQ_YN) = 'Y' (결재자 조회한 것만)
- 계약 유형(CTR_CLSF_CD): '00', '10', '20', '50' (직매입·특약·온라인판매계약 등)

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| 400 | 유효성 실패 | jRowBounds 누락 |
| 401 | 인증 실패 | 토큰 없음/만료 |
| 403 | 접근 거부 | 권한 없음 (SYSADMIN 아님) |
| 500 | 서버 오류 | DB 쿼리 실패 |

## 참조 테이블

| 테이블 | SCH |
|--------|-----|
| PRD_PRD_PRS_CNSL_M | [TBD] |
| PRD_DLR_M | [TBD] |
| PRD_MD_M | [TBD] |
| PRD_CTDC_CTL_M | [TBD] |
| JT_CODE | [TBD] |
| CMM_BO_USR_M | [TBD] |

## curl 예시

```bash
curl -X POST /app/product/appreg/pr303List \
  -H "Content-Type: application/json" \
  -d '{
    "jRowBounds": {
      "offset": 0,
      "limit": 10
    },
    "SCH_FROM_INST_DTM": "2026-01-01",
    "SCH_TO_INST_DTM": "2026-06-30",
    "SCH_MD_ID": "MD001",
    "SCH_CTR_CLSF_CD": "00"
  }'
```
