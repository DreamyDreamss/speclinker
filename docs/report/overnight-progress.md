# 오버나이트 작업 로그 (2026-06-05)

> 사용자 지시: C-1/2/3 수정+버전업+푸시 → T1~T4 단계별 커밋/푸시 → 아침 보고.

## 완료
- [x] **CRITICAL 수정 (v3.6.0, 0bb154c)** — C-1 relPath 매칭, C-2 inventory_hash(양 디스패처), C-3 goto fragment 필터. 검증: jwork 조각제외+Next.js무영향, 회귀 통과.

## 진행
- [x] **T1-A 엔티티 자동추출 (74ab3aa)** — extract_entities.py: 스펙 어휘 교차검증+휴리스틱으로 SR/첨부→테이블·INF·path. 미확인 후보 분리. 테스트 PASS.
- [x] **T1-B ripple 랭킹·격리 (6a3935a)** — 관련도 점수(연결테이블 기반)+상위K+편재감쇠. **JT_CODE 176노이즈→광역공통자원 격리(#4 해결)**. 전이(--hops). sl-change Step5 연결. 테스트 3 PASS.
- [x] **T2 현행성 게이트 (a976ad9, 2e347f7)** — build_change_context freshness: 앵커 소스 mtime > 스펙 mtime → STALE 경고(소스 1차진실). extract_entities tables_unknown으로 그래프 누락 신호. 테스트 4 PASS.
- [x] **T3-A 충실도 하네스 (ffb4144)** — eval_fidelity.py: 테이블추출 P/R/F1 + 워크시트. **nkshop 실측 P0.70/R0.18/F0.28(17/120 SQL앵커)** = 결함#1 정량입증. findings 문서화.
- [x] **T3-B AIDD A/B 하네스 (48707cc)** — eval_aidd.py: 풀그라운딩 vs 소스만 통과율·결함 비교(H4), 독립오라클.
- [x] **T4 산출물품질 (c5af6e6)** — ddd-db-agent 코드값 사실역인용(출처·[미확인]) + build_domain_overview.py(신규자 SOP 내러티브, 기계인덱스 분리). v3.7.0.

## 결과 요약
- CRITICAL 3 + T1~T4 전부 완료·푸시. 신규 스크립트 6 + 에이전트/스킬 갱신. 단위테스트 5파일 7케이스 전부 PASS.
- 버전: 3.3.0 → **3.7.0** (3.6.0 CRITICAL, 3.7.0 T1~T4).
- 미해결(설계상 한계/반자동): H1 비즈규칙 충실도(전문가 주석 필요), H4 AIDD A/B(실행루프 필요), H2 SOP 가독성(사용자연구), 의도/암묵의존(정적분석 천장).
