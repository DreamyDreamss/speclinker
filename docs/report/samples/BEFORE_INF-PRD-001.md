---
inf-id: INF-PRD-001
method: POST
path: /app/product/appreg/pr301mAppList
domain: product
domain-code: PRD
req-f: [TBD]
srs-f: [TBD]
screens: []
tables:
  - PRD_PC_APP_D
  - PRD_PRD_M
  - PRD_MD_M
  - PRD_DLR_M
  - PRD_CLS_M
  - JT_CODE
  - PRD_BRND_M
  - PRD_PC_APP_CNSL_D
  - FUL_PO_D
  - FUL_PO_M
  - PRD_ISD_APP_D
  - ORD_CARD_INTF_D
  - ORD_CRC_M
  - PRD_MRPR_IPT_D
  - PRD_PRD_IMG_D
  - PRD_PC_CHG_D
  - PRD_PRD_SRCH_UPL_D
---

# INF-PRD-001: POST /app/product/appreg/pr301mAppList — 결재목록 조회 (페이징)

> **근거 소스:** `src/main/java/com/kth/nkshop/bos/admin/product/appreg/controller/Pr301Controller.java:162-229`  
> `src/main/resources/sqlmapper/product/appreg/PrdAppInstPagingMapper.xml:7-331`

## 요청

- Method: POST
- Path: /app/product/appreg/pr301mAppList
- Content-Type: application/x-www-form-urlencoded (GridParameter + form fields)

| 파라미터 | 위치 | 타입 | 필수 | 설명 |
|---------|------|------|------|------|
| paramBeginPcBgnDtm | Body | String | Y | 검색 시작일 (yyyy-mm-dd) |
| paramEndPcBgnDtm | Body | String | Y | 검색 종료일 (yyyy-mm-dd) |
| paramMdAuthList | Body | String (JSON Array) | N | 사용자 MD 권한목록 (JSON 문자열) |
| paramMdId | Body | String | N | MD ID |
| paramDlrId | Body | String | N | 협력사 ID |
| paramPrdId | Body | String | N | 상품 ID |
| paramPrdUploadId | Body | String | N | 상품코드 엑셀업로드 ID |
| paramSlStlCd | Body | String | N | 판매상태코드 |
| paramSrcngMdaTpCd | Body | String | N | 소싱매체구분코드 |
| paramSchType | Body | String | N | 검색유형코드 (01~09) |
| paramDlrCncrnStsCd | Body | String | N | 협력사합의상태코드 |
| paramStdInfoCncrnStsCd | Body | String | N | 기준정보합의상태코드 |
| paramDstRbApvStsCd | Body | String | N | 물류승인상태코드 |
| paramPrdAppStsCd | Body | String | N | 상품결재상태코드 |
| offset | Body | int | Y | 페이징 offset (JRowBounds에서 추출) |
| limit | Body | int | Y | 페이징 limit (JRowBounds에서 추출) |

## 응답 (200 OK)

```json
{
  "code": "00",
  "rows": [
    {
      "PRD_ID": "PRD2019001234",
      "PRD_NM": "샘플상품명",
      "MD_ID": "MD001",
      "MD_NM": "홍길동",
      "SRCNG_MDA_TP_NM": "TV홈쇼핑",
      "SL_MDA_TP_NM": "TV",
      "PRD_APP_STS_NM": "상신",
      "DLR_CNCRN_STS_NM": "합의",
      "STD_INFO_CNCRN_STS_NM": "합의",
      "DSTRB_APV_STS_NM": "승인",
      "SL_STS_NM": "판매중",
      "PC_BGN_DTM": "2024-01-01 00:00:00",
      "SRCNG_MDA_TP_CD": "10",
      "MARGIN_RATE": 25.50,
      "DC_MARGIN_RATE": 23.10,
      "PRD_APP_STS_CD": "20",
      "DLR_CNCRN_STS_CD": "20",
      "STD_INFO_CNCRN_STS_CD": "02",
      "DSTRB_APV_STS_CD": "80",
      "SL_STS_CD": "10",
      "SL_MDA_TP_CD": "10",
      "APP_SEQ": 1,
      "ISD_APP_NO": "APP202401001",
      "MNL_CLSF_CD": "01",
      "PPM_PRD_APP_STS_CD": "20",
      "APP_IMPSS_RSN_CD": "",
      "PC_APP_IMPSS_CNN": "",
      "IMG_YN": "Y",
      "BRAND_CONFIRM_YN": "Y",
      "PRS_PC": 50000,
      "PRS_PC_CONFIRM": 48000,
      "PRS_WAY_TP_CD": "10",
      "PO_YN": "Y",
      "FIRST_YN": "Y",
      "STD_INFO_CNCRN_DTM": "2024-01-02 10:00:00",
      "STD_INFO_ASNT_ID": "USER001",
      "DLR_CNCRN_DTM": "2024-01-03 10:00:00",
      "DLR_ASNT_ID": "DLR001",
      "DSTRB_APV_DTM": "2024-01-04 10:00:00",
      "DSTRB_CFMR_ID": "CFMR001",
      "PRS_CLSF_CD": "00",
      "PRD_CLSF_CD": "00",
      "PRD_SP_TP_CD": "00",
      "MRPR_ID": "MRPR001",
      "DP_INTG_YN": "N",
      "DP_PRD_ID": null,
      "DP_INTG_APP_PRD_ID": null,
      "DLR_ID": "DLR001",
      "MDL_ID": "MDL001",
      "DLR_PMT_CNCRN_TRT_YN": "N",
      "DLR_PMT_CNCRN_TRT": "N",
      "DLR_PMT_CNCRN_PGS_YN": "N",
      "APPR_ID": "APPR001",
      "KIMS_DRFT_NO": null,
      "CTR_APP_TP_CD": null,
      "ELTR_CTR_NO": null,
      "ELTR_CTR_DG": null,
      "PRD_LCLS_ID": "10",
      "PRD_MCLS_ID": "1001",
      "PRD_SCLS_ID": "100101",
      "PRD_DCLS_ID": "10010101",
      "PRD_PC_SEQ": 1001,
      "PC_EVDN_FILE_ID": null,
      "PRICE_ERR": null,
      "SCH_MDF_DTM": "2024-01-01 09:00:00",
      "ONLINE_SL_EXCS_YN": "N",
      "SECU_YN": "N",
      "INTF_INTT_USE_YN": "N",
      "INTF_INTT_MMS": 0,
      "ECPN_PRD_YN": "N",
      "SHTR_INTF": 0,
      "INTT_YN": "Y",
      "TXTN_CLSF_CD": "1",
      "TXTN_CLSF_NM": "과세",
      "PCM_TXTN_CLSF_CD": "1",
      "PCM_TXTN_CLSF_NM": "과세",
      "RNUM": 1,
      "TOTAL_COUNT": 150
    }
  ],
  "totalCount": 150
}
```

## 비즈니스 규칙

- **paramSchType 분기**: 01=상신대상(PRD_APP_STS_CD='00'), 02=상신(20), 03=팀장승인대상(상신+협력사합의+기준정보합의+물류승인), 04=팀장승인된건, 05=기준정보의뢰대상, 06=기준정보합의대상, 07=상신취소, 08=기준정보반려, 09=팀장반려
- **paramMdAuthList**: JSON 문자열로 전달된 MD 권한목록을 파싱하여 `IN` 조건으로 적용. 빈값이면 빈 리스트 처리
- **페이징 방식**: ROW_NUMBER() OVER (ORDER BY) 로 RNUM 부여 후 offset/limit 슬라이싱. 건수 쿼리는 별도 selectAppListCount로 분리 (성능 개선)
- **TOTAL_COUNT**: 서비스에서 조회 목록의 각 row에 totalCount를 put함
- **필터**: 팩상품(PRD_CLSF_CD >= '50') 제외, 폐기/판매종료(SL_STS_CD >= '19') 제외, 임시저장(PRD_APP_STS_CD = '05') 제외

## 트랜잭션 순서

해당 없음 (SELECT 전용)

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| (BizRuntimeException) | 조회 오류 | DB 오류 발생 시 jwork.error.default 예외 전환 |

## 참조 테이블

| 테이블 | SCH |
|--------|-----|
| PRD_PC_APP_D | [TBD] |
| PRD_PRD_M | [[SCH-PRD-001]] |
| PRD_MD_M | [TBD] |
| PRD_DLR_M | [TBD] |
| PRD_CLS_M | [TBD] |
| JT_CODE | [TBD] |
| PRD_BRND_M | [TBD] |
| PRD_PC_APP_CNSL_D | [TBD] |
| FUL_PO_D | [TBD] |
| FUL_PO_M | [TBD] |
| PRD_ISD_APP_D | [TBD] |
| ORD_CARD_INTF_D | [TBD] |
| ORD_CRC_M | [TBD] |
| PRD_MRPR_IPT_D | [TBD] |
| PRD_PRD_IMG_D | [TBD] |
| PRD_PC_CHG_D | [TBD] |
| PRD_PRD_SRCH_UPL_D | [TBD] |

## curl 예시

```bash
curl -X POST /app/product/appreg/pr301mAppList \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'paramBeginPcBgnDtm=2024-01-01&paramEndPcBgnDtm=2024-01-31&offset=0&limit=20'
```
