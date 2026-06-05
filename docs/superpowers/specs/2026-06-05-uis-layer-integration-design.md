# UIS 레이어 통합 — JIT 그래프 연결(A) + 화면중심 사람 SOP(B) 설계서

- 작성일: 2026-06-05
- 대상: UIS(화면 설계서)를 변경 그라운딩(JIT)과 사람 온보딩 양쪽에 활용
- 배경: UIS는 JIT-가능 재료(api_hints·§5·screen_inventory)를 갖췄으나 **JIT 파이프라인에 미연결**(spec_graph가 INF/SCH만 읽음). 사람 SOP는 테이블빈도 나열로 얕음. 하나의 UIS를 두 소비자가 쓰게 한다.

## 1. 확정 포맷 (실생성물 기준, SAMPLE_UIS_pr301mForm.md)
- frontmatter **한글 키**: `화면ID`, `화면명`, `라우트`, `도메인`, `UIS-ID`, `api_hints`(리스트, 있을 때), `req-f`.
- 본문: `§5 인터랙션`(이벤트→위젯→**API(INF)**→전환→에러), `§4 위젯`(연결 API·소스). 캡처 완전성에 의존(빈약하면 비어 있음).
- **근거 소스 = 캡처 URL**(프론트 파일 아님). 화면→프론트소스 매핑은 `_tmp/screen_inventory_static.json`에 별도 존재.

## 2. 확정 원칙
- **공유 UIS 리더 1개** → (A) JIT 그래프와 (B) 사람 SOP가 같은 파싱을 소비(중복 0).
- UIS↔INF = `api_hints` + §5의 INF 참조. UIS↔프론트소스 = `screen_inventory_static.json`(있으면).
- UIS 파일 포맷·생성기 **무변경**(읽기만). 캡처 빈약 시 UIS 정보가 적은 것은 *데이터 한계*로 수용.

## 3. 컴포넌트

### 3-1. 공유 UIS 리더 — `spec_graph_build.py` 확장
- `docs/05_설계서/**/spec.md`(또는 UIS-*.md) 스캔 → 한글 frontmatter 파싱.
- 본문에서 INF-ID 참조 추출(`INF-[A-Z]+-\d+`).
- `_tmp/screen_inventory_static.json`(있으면) → screenId→소스파일.
- 그래프: `graph['uis'][UIS-ID]={screen_id,screen_name,route,domain,infs,anchors,file}` + `graph['screen_to_inf']`.
- 하위호환: UIS 없으면 빈 dict(INF/SCH 무영향).

### 3-2. (A) JIT — `build_change_context.py` + `extract_entities.py`
- extract_entities: 화면명·UIS-ID·라우트도 추출.
- build_change_context: UIS 시드 → 화면+연결INF+프론트소스 영향슬라이스. INF 시드 → 그 INF 쓰는 화면 ripple.
- 브리프에 `## 영향 화면(UIS)` 섹션.

### 3-3. (B) 사람 SOP — `build_domain_overview.py` 화면중심화
- 대표 화면 섹션: 화면명·라우트·연결 INF + (있으면)§5 1줄 요약.
- 진입점을 "대표 화면부터"로 재정렬.

## 4. 검증
- 합성 UIS 픽스처(한글 frontmatter + INF 참조) → 리더가 uis 노드·screen_to_inf.
- (A) 화면명 → 화면+연결INF 슬라이스. INF 시드 → 화면 ripple.
- (B) 개요에 대표 화면+연결 API.
- 실 nkshop SAMPLE_UIS로 리더 동작(캡처 빈약 한계 인지).
- 전체 단위테스트 회귀.

## 5. 불변식
- UIS 생성기·포맷 무변경. spec_graph INF/SCH 무영향. build_change_context 기존 동작 보존(UIS 가산).
- UIS 없으면 전부 빈 동작(무해).

## 6. 구현 분해
1. 3-1 공유 UIS 리더 → 2. 3-2 (A) JIT → 3. 3-3 (B) 화면중심 SOP. 각 TDD + 합성 픽스처.

## 7. 한계 (정직)
- 캡처 빈약 = UIS 정보 빈약(현 nkshop preview.png만 → §4/§5 비어 UIS↔INF 약함). 완전 캡처(widgets.json·구동앱) 필요.
- 캡처 경로 UIS는 프론트소스 앵커 없음 → screen_inventory 의존. 없으면 UIS JIT는 화면↔INF까지만.
- UIS JIT 실효는 캡처·screen_inventory 완전성에 비례. 백엔드 변경엔 무관(4-2 결론 유지).
