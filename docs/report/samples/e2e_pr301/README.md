# E2E 검증 — 상품등록화면(pr301mForm) 하나로 INF·SCH·UIS·doc 끝까지

> 2026-06-05. nkshop `Pr301Controller`(상품등록화면 데이터 API) 1개로 RECON 전 단계를 실제 실행한 산출물.
> 현행 플러그인(v3.8.0 + UIS 레이어 통합) 기준. INF는 haiku 디스패처, SCH/UIS/doc는 zero-LLM 스크립트.

## 산출물
| 파일 | 단계 | 생성 |
|------|------|------|
| `INF-PRD-001.md` | sl-recon STEP 4-3 | ddd-api-agent (haiku) |
| `SCH/SCH-PRD-001~015.md` (15개) | sl-recon STEP 5-A | build_sch_static (zero-token) |
| `DB_Schema.md` | STEP 5-A | build_sch_static (색인) |
| `UIS-PRD-001_spec.md` | sl-recon-uis | generate_uis_spec (캡처) |
| `OVERVIEW_product.md` | sl-recon-doc STEP 9-5 | build_domain_overview (zero-LLM) |

## 검증 포인트
1. **INF full-chain 앵커** — frontmatter `anchors:`에 controller→service→mapper인터페이스→MyBatis XML **4단계**. 변경 시 SQL·로직까지 JIT 회귀 가능.
2. **SCH 15건** — INF의 15개 테이블에서 zero-token 스켈레톤 + DB_Schema 색인. 코드값/비즈주의는 `<!-- LLM-TODO -->`(enrichment 대상).
3. **UIS** — 한글 frontmatter(화면ID/화면명/라우트/UIS-ID), §0~§5 구조. (이 캡처는 preview.png만 있어 §4 위젯·§5 인터랙션 빈약 — 캡처 완전성 한계)
4. **OVERVIEW(사람 SOP)** — **대표 화면(UIS) 섹션** + 진입점 "화면부터". UIS 레이어 통합 결과.

## 정직한 한계 (이 산출물에서 드러난 것)
- **UIS↔INF 미연결**: OVERVIEW의 "상품등록폼 — 연결 API 미확인". 캡처에 api_hints/§5가 없어(스크린샷만) 화면→API 매핑이 비었다. **완전 캡처(widgets.json, 구동 앱)** 가 있어야 채워진다.
- INF 본문에 "앵커 규칙" 지침 텍스트가 섞여 나옴 → ddd-api-agent 템플릿에서 지침을 본문 밖으로 분리(후속 수정).
