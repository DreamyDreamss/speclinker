---
inf-id: INF-PRD-001
method: POST
path: /product/appreg/pr301mAppList
domain: product
domain-code: PRD
req-f: "[TBD]"
srs-f: "[TBD]"
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
  - PRD_PRD_IMG_D
  - PRD_PC_CHG_D
  - FUL_PO_D
  - FUL_PO_M
  - PRD_ISD_APP_D
  - ORD_CARD_INTF_D
  - ORD_CRC_M
anchors:
  - "src/main/java/com/kth/nkshop/bos/admin/product/appreg/controller/Pr301Controller.java:162-229"
  - "src/main/java/com/kth/nkshop/bos/admin/product/appreg/service/impl/PrdAppInstPagingServiceImpl.java:56-66"
  - "src/main/java/com/kth/nkshop/bos/admin/product/appreg/mapper/PrdAppInstPagingMapper.java:42"
  - "src/main/resources/sqlmapper/product/appreg/PrdAppInstPagingMapper.xml:7-331"
---

# INF-PRD-001: POST /product/appreg/pr301mAppList — 결재목록 조회 (페이징)

> **근거 소스:** `src/main/java/com/kth/nkshop/bos/admin/product/appreg/controller/Pr301Controller.java:162-229`

> **앵커 규칙 (full-chain — 4-1):** frontmatter `anchors:` 배열에는 이 INF가 호출 체인 전체를 기록한다:
> controller 진입(162-229) → PrdAppInstPagingService 구현(56-66) → Mapper 인터페이스(42) → MyBatis XML SQL(7-331).
> 이는 변경 시 AI가 SQL 및 비즈로직까지 소스로 직접 회귀(JIT)하는 근거다.

## 요청

- Method: POST
- Path: /product/appreg/pr301mAppList
- Content-Type: application/json

| 파라미터 | 위치 | 타입 | 필수 | 설명 |
|---------|------|------|------|------|
| paramBeginPcBgnDtm | Body | String | ✓ | 적용 기간 시작 (yyyy-mm-dd) |
| paramEndPcBgnDtm | Body | String | ✓ | 적용 기간 종료 (yyyy-mm-dd) |
| paramMdId | Body | String | ✗ | MD ID |
| mdCodes | Body | Array[String] | ✗ | MD 코드 목록 |
| paramDlrId | Body | String | ✗ | 협력사 ID |
| paramPrdId | Body | String | ✗ | 상품 ID |
| paramPrdUploadId | Body | String | ✗ | 상품 업로드 ID (엑셀 업로드) |
| paramSlStlCd | Body | String | ✗ | 판매상태코드 |
| paramSrcngMdaTpCd | Body | String | ✗ | 소싱매체구분코드 |
| paramSchType | Body | String | ✗ | 검색 유형 ('01'~'09') |
| paramUserId | Body | String | ✗ | 사용자 ID (paramSchType='03' 또는 '04'일 때 필수) |
| paramDlrCncrnStsCd | Body | String | ✗ | 협력사합의상태코드 |
| paramStdInfoCncrnStsCd | Body | String | ✗ | 기준정보합의상태코드 |
| paramDstRbApvStsCd | Body | String | ✗ | 물류승인상태코드 |
| paramPrdAppStsCd | Body | String | ✗ | 상품결재상태코드 |
| paramMdAuthList | Body | String | ✗ | MD 권한 목록 (JSON 배열 문자열) |
| offset | Body (GridParameter) | Number | ✓ | 페이징 시작 위치 |
| limit | Body (GridParameter) | Number | ✓ | 페이징 건수 |

## 응답 (200 OK)

```json
{
  "code": "00",
  "data": [
    {
      "PRD_ID": "상품ID",
      "PRD_NM": "상품명",
      "MD_ID": "MD ID",
      "MD_NM": "MD명",
      "SRCNG_MDA_TP_NM": "소싱매체구분코드명",
      "SL_MDA_TP_NM": "판매매체구분코드명",
      "PRD_APP_STS_NM": "상품결재상태코드명",
      "DLR_CNCRN_STS_NM": "협력사합의상태코드명",
      "STD_INFO_CNCRN_STS_NM": "기준정보합의상태코드명",
      "DSTRB_APV_STS_NM": "물류승인상태코드명",
      "SL_STS_NM": "판매상태명",
      "PC_BGN_DTM": "2024-01-01 00:00:00",
      "SRCNG_MDA_TP_CD": "소싱매체구분코드",
      "MARGIN_RATE": 25.5,
      "DC_MARGIN_RATE": 22.3,
      "PRD_APP_STS_CD": "20",
      "DLR_CNCRN_STS_CD": "20",
      "STD_INFO_CNCRN_STS_CD": "02",
      "DSTRB_APV_STS_CD": "80",
      "SL_STS_CD": "10",
      "SL_MDA_TP_CD": "10",
      "APP_SEQ": "1",
      "ISD_APP_NO": "내부결재번호",
      "MNL_CLSF_CD": "기술서유형코드",
      "PPM_PRD_APP_STS_CD": "20",
      "APP_IMPSS_RSN_CD": "",
      "PC_APP_IMPSS_CNN": "",
      "IMG_YN": "Y",
      "BRAND_CONFIRM_YN": "N",
      "PRS_PC": 10000,
      "PRS_PC_CONFIRM": 10000,
      "PRS_WAY_TP_CD": "10",
      "PO_YN": "Y",
      "FIRST_YN": "N",
      "STD_INFO_CNCRN_DTM": "2024-01-01 10:00:00",
      "STD_INFO_ASNT_ID": "승인자ID",
      "DLR_CNCRN_DTM": "2024-01-02 14:30:00",
      "DLR_ASNT_ID": "협력사승인자ID",
      "DSTRB_APV_DTM": "2024-01-03 09:15:00",
      "DSTRB_CFMR_ID": "물류승인자ID",
      "PRS_CLSF_CD": "00",
      "PRD_CLSF_CD": "00",
      "PRD_SP_TP_CD": "00",
      "MRPR_ID": "한계이익ID",
      "DP_INTG_YN": "N",
      "DP_PRD_ID": "전시상품ID",
      "DP_INTG_APP_PRD_ID": "전시대표상품상신ID",
      "DLR_ID": "협력사ID",
      "MDL_ID": "MD팀장ID",
      "DLR_PMT_CNCRN_TRT_YN": "N",
      "DLR_PMT_CNCRN_TRT": "N",
      "DLR_PMT_CNCRN_PGS_YN": "N",
      "APPR_ID": "결재자ID",
      "KIMS_DRFT_NO": "KIMS기안번호",
      "CTR_APP_TP_CD": "계약결재구분코드",
      "ELTR_CTR_NO": "전자계약번호",
      "ELTR_CTR_DG": "전자계약차수",
      "PRD_LCLS_ID": "상품대분류ID",
      "PRD_MCLS_ID": "상품중분류ID",
      "PRD_SCLS_ID": "상품소분류ID",
      "PRD_DCLS_ID": "상품세분류ID",
      "PRD_PC_SEQ": "상품가격일련번호",
      "PC_EVDN_FILE_ID": "증빙자료 파일ID",
      "PRICE_ERR": "일시불 가격 오류",
      "SCH_MDF_DTM": "2024-01-04 11:20:30",
      "ONLINE_SL_EXCS_YN": "N",
      "SECU_YN": "N",
      "INTF_INTT_USE_YN": "Y",
      "INTF_INTT_MMS": 12,
      "ECPN_PRD_YN": "N",
      "SHTR_INTF": 3,
      "INTT_YN": "Y",
      "TXTN_CLSF_CD": "10",
      "TXTN_CLSF_NM": "과세 유형명",
      "PCM_TXTN_CLSF_CD": "10",
      "PCM_TXTN_CLSF_NM": "상품분류 과세 유형명",
      "TOTAL_COUNT": 150
    }
  ],
  "recordsTotal": 150,
  "recordsFiltered": 150
}
```

## 비즈니스 규칙

- **검색 유형별 필터링**: paramSchType 값에 따라 다른 상태 조건 적용
  - '01': 상신대상 (PRD_APP_STS_CD = '00')
  - '02': 상신건 (PRD_APP_STS_CD = '20')
  - '03': 팀장승인대상 (추가 조건: 협력사합의, 기준정보합의, 물류승인 상태 검증)
  - '04': 팀장승인완료건 (PRD_APP_STS_CD = '80')
  - '05': 기준정보의뢰 대상
  - '06': 기준정보합의 대상
  - '07': 상신취소건
  - '08': 기준정보반려 대상
  - '09': 팀장반려건
- **데이터 제외 규칙**: 팩상품(PRD_CLSF_CD >= '50'), 폐기/판매종료(SL_STS_CD >= '19'), 임시저장(PRD_APP_STS_CD = '05') 제외
- **MD 권한 필터링**: paramMdAuthList가 전달되면 사용자가 접근 가능한 MD의 상품만 조회
- **마진율 계산 (MARGIN_RATE)**: 판매가와 매입가 기반 마진율 계산. 분자가 0이면 마진율 0 반환
- **할인마진율 계산 (DC_MARGIN_RATE)**: 할인 고려 마진율 계산
- **NULL 처리**: 모든 필드는 NULL → 빈 문자열로 변환 (서비스 구현에서 처리)

## 트랜잭션 순서

조회 전용 API이므로 DB 쓰기 작업 없음.

1. 전체 건수 조회 (`selectAppListCount` 별도 쿼리 실행) 
2. 페이징된 목록 조회 (`selectAppListWithPaging` 실행)
3. 결과 배열 각 항목에 TOTAL_COUNT 필드 추가

## 오류 응답

| 코드 | 사유 | 발생 조건 |
|------|------|---------|
| 400 | 유효성 실패 | paramBeginPcBgnDtm, paramEndPcBgnDtm 누락 또는 형식 오류 |
| 401 | 인증 실패 | 세션 없음/만료 |
| -99 | 시스템 오류 | 쿼리 실행 오류, 데이터베이스 연결 실패 |

## 참조 테이블

| 테이블 | SCH | 설명 |
|--------|-----|------|
| PRD_PC_APP_D | [TBD] | 가격결재상세 |
| PRD_PRD_M | [TBD] | 상품마스터 |
| PRD_MD_M | [TBD] | MD마스터 |
| PRD_DLR_M | [TBD] | 협력사마스터 |
| PRD_CLS_M | [TBD] | 상품분류마스터 |
| JT_CODE | [TBD] | 공통코드 |
| PRD_BRND_M | [TBD] | 브랜드마스터 |
| PRD_PC_APP_CNSL_D | [TBD] | 가격결재품의상세 |
| PRD_PRD_IMG_D | [TBD] | 상품이미지상세 |
| PRD_PC_CHG_D | [TBD] | 상품가격변경 |
| FUL_PO_D | [TBD] | 발주상세 |
| FUL_PO_M | [TBD] | 발주마스터 |
| PRD_ISD_APP_D | [TBD] | 상품내부결재 |
| ORD_CARD_INTF_D | [TBD] | 주문카드인터페이스 |
| ORD_CRC_M | [TBD] | 주문카드컨트롤 |

## curl 예시

```bash
curl -X POST http://localhost:8080/app/product/appreg/pr301mAppList \
  -H "Content-Type: application/json" \
  -d '{
    "paramBeginPcBgnDtm": "2024-01-01",
    "paramEndPcBgnDtm": "2024-12-31",
    "paramMdId": "MD001",
    "paramSchType": "02",
    "offset": 0,
    "limit": 10
  }'
```
