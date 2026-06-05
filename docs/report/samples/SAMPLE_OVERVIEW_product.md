# product 도메인 개요 (신규자·신규요건 분석용)

> 사람용 SOP 레이어. 기계용 인덱스(INF/SCH frontmatter·앵커)와 분리된 개념 설명이다.

## 목적
상품 등록·변경·조회·승인, 가격, 팝업, 리뷰, 표준정보, 계약상담, 프로모션 관리

## 핵심 엔티티 (사용 빈도순 — 이 테이블부터 이해)

- **JT_CODE** (176개 기능에서 사용) → SCH-PRD-028
- **PRD_PRD_M** (102개 기능에서 사용) → SCH-PRD-001
- **PRD_MD_M** (80개 기능에서 사용) → SCH-PRD-170
- **JT_USER** (66개 기능에서 사용) → SCH-PRD-033
- **PRD_DLR_M** (62개 기능에서 사용) → SCH-PRD-142
- **PRD_CLS_M** (45개 기능에서 사용) → SCH-PRD-124
- **PRD_PRD_PRS_CNSL_M** (37개 기능에서 사용) → SCH-PRD-231
- **VW_CMM_DEPT_X** (33개 기능에서 사용) → SCH-PRD-295

## 대표 기능 (639개 중 진입점)

- POST `/app/product/appreg/chgCtrAppList` — [INF-PRD-066](INF/INF-PRD-066.md)
- POST `/app/product/appreg/chgCtrList` — [INF-PRD-063](INF/INF-PRD-063.md)
- POST `/app/product/appreg/ctrDgDlList` — [INF-PRD-065](INF/INF-PRD-065.md)
- POST `/app/product/appreg/ctrDgList` — [INF-PRD-064](INF/INF-PRD-064.md)
- POST `/app/product/appreg/drprcChgCtrAppList` — [INF-PRD-071](INF/INF-PRD-071.md)
- POST `/app/product/appreg/drprcChgCtrList` — [INF-PRD-068](INF/INF-PRD-068.md)
- POST `/app/product/appreg/drprcChgCtrPrdList` — [INF-PRD-072](INF/INF-PRD-072.md)
- POST `/app/product/appreg/drprcCtrDgDlList` — [INF-PRD-070](INF/INF-PRD-070.md)
- POST `/app/product/appreg/drprcCtrDgList` — [INF-PRD-069](INF/INF-PRD-069.md)
- POST `/app/product/appreg/drprcPrsCnslPrdList` — [INF-PRD-073](INF/INF-PRD-073.md)
- POST `/app/product/appreg/findPrdOrdPssQtyMList` — [INF-PRD-005](INF/INF-PRD-005.md)
- POST `/app/product/appreg/findPrdPcAppList` — [INF-PRD-004](INF/INF-PRD-004.md)

## 신규자 진입점
1. 위 **핵심 엔티티** 상위 2~3개의 SCH(DB_product.md)로 데이터 구조 파악
2. **대표 기능**의 INF 1~2개를 열어 요청/응답·비즈니스 규칙 확인
3. 변경 작업 시 `/sl-change`가 영향슬라이스+소스앵커로 정밀 그라운딩을 제공
4. 화면은 UIS, 전체 DB는 DB_product.md 참조

