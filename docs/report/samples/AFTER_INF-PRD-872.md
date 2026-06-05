---
inf-id: INF-PRD-872
method: POST
path: /app/product/appreg/pr303AppList
domain: product
domain-code: PRD
req-f: "[TBD]"
srs-f: "[TBD]"
screens: []
tables:
  - PRD_ISD_APP_D
  - CMM_BO_USR_M
  - VW_CMM_DEPT_X
  - JT_CODE
anchors:
  - nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/controller/Pr303Controller.java:133-143
  - nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/service/impl/PrdAppIfServiceImpl.java:6305-6308
  - nkshop-bos-admin/src/main/resources/sqlmapper/product/ctrcnslapp/PrdAppIfMapper.xml:1333-1381
---

# INF-PRD-872: POST /app/product/appreg/pr303AppList — 매입품의 결재선 조회

> **근거 소스:** `nkshop-bos-admin/src/main/java/com/kth/nkshop/bos/admin/product/ctrcnslapp/controller/Pr303Controller.java:133-143`

> **앵커 규칙 (full-chain — 4-1):** 이 INF는 Controller → Service → Mapper SQL 전체 호출 체인을 추적합니다.
> 진입점(Controller `pr303AppList`), 비즈니스 로직(Service `selectApprovalUserListForIsdappno`), 
> 쿼리 실행(Mapper `selectApprovalUserListForIsdappno`)의 세 단계 모두가 `anchors:` 배열에 기록됩니다.

## 요청

- Method: POST
- Path: /app/product/appreg/pr303AppList
- Content-Type: application/json

| 파라미터 | 위치 | 타입 | 필수 | 설명 |
|---------|------|------|------|------|
| jRowBounds | Body | object | Y | 페이징 정보 (jwork GridParameter) |
| ISD_APP_NO | Body | string | Y | 내부결재번호 |

## 응답 (200 OK)

```json
{
  "records": [
    {
      "ISD_APP_NO": "내부결재번호",
      "ISD_APP_ORDR": "내부결재순서",
      "ROW_ORDR": "행 순서",
      "ISD_APPR_ID": "내부결재자ID",
      "USR_NM": "내부결재자명",
      "ISD_APP_DTM": "YYYY-MM-DD HH24:MI:SS",
      "DEPT_ID": "부서ID",
      "DEPT_NM": "부서명",
      "ISD_APPR_RSOF_TP_CD": "내부결재자직책구분코드",
      "ISD_APP_TP_CD": "내부결재구분코드",
      "ISD_APP_TP_NM": "내부결재구분명",
      "ORG_PRS_CNSL_APP_ORDR": "원매입품의결재순서",
      "ISD_APP_LS_APP_YN": "내부결재최종결재여부",
      "APP_STS_CD": "결재상태코드",
      "APP_STS_NM": "결재상태명",
      "ISD_APP_RJCT_RSN": "내부결재반려사유",
      "ISD_APP_APPR_OPIN_CNN": "내부결재자의견내용",
      "INST_DTM": "YYYY-MM-DD",
      "INSTPR_ID": "등록자ID",
      "MDF_DTM": "YYYY-MM-DD",
      "MDFPR_ID": "수정자ID"
    }
  ],
  "total": "전체 건수",
  "page": "현재 페이지"
}
```

## 비즈니스 규칙

- 내부결재번호(ISD_APP_NO)를 기준으로 결재자 목록을 조회함
- 결재 순서(ISD_APP_ORDR) 순서로 정렬되며, ROW_ORDR은 각 결재번호 내에서의 상대 순서
- 결재 상태(APP_STS_CD): 승인('10'), 반려('20'), 진행중('30') 등의 코드 사용
- 최종 결재자(ISD_APP_LS_APP_YN): 'Y'는 마지막 결재자, 'N'은 중간 결재자

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| 400 | 유효성 실패 | ISD_APP_NO 누락 또는 jRowBounds 누락 |
| 401 | 인증 실패 | 토큰 없음/만료 |
| 404 | 리소스 없음 | 해당 ISD_APP_NO가 없음 |
| 500 | 서버 오류 | DB 쿼리 실패 |

## 참조 테이블

| 테이블 | SCH |
|--------|-----|
| PRD_ISD_APP_D | [TBD] |
| CMM_BO_USR_M | [TBD] |
| VW_CMM_DEPT_X | [TBD] |
| JT_CODE | [TBD] |

## curl 예시

```bash
curl -X POST /app/product/appreg/pr303AppList \
  -H "Content-Type: application/json" \
  -d '{
    "jRowBounds": {
      "offset": 0,
      "limit": 10
    },
    "ISD_APP_NO": "20260605000001"
  }'
```
