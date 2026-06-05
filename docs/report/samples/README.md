# INF 레이어 재설계 — 실생성 샘플 (검증물)

> 2026-06-05. nkshop `Pr303Controller`를 **현행 ddd-api-agent(v3.8.0)로 실제 재생성**한 결과.
> 사용자가 직접 before/after를 비교하도록 보존한 검증물이다. (haiku 모델, 디스패처 실행)

## 파일
- `BEFORE_INF-PRD-001.md` — **재설계 전** 기존 nkshop INF (구식)
- `AFTER_INF-PRD-871.md`, `AFTER_INF-PRD-872.md` — **재설계 후** 새로 생성된 INF

## before → after 핵심 차이

### 1. 앵커 (4-1 full-chain)
| | BEFORE | AFTER |
|---|--------|-------|
| frontmatter `anchors:` | **없음** | **있음 — controller+service+mapper 3단계** |
| 본문 `근거 소스` | controller(+일부 mapper) | controller (하위호환 병기) |

**AFTER 예시 (INF-PRD-871):**
```yaml
anchors:
  - "...controller/Pr303Controller.java:81-109"            # 진입
  - "...service/impl/PrdPrdPrsCnslMServiceImpl.java:154-162"  # 비즈로직
  - "...sqlmapper/.../PrdPrdPrsCnslMMapper.xml:1148-1248"     # SQL
```
→ 변경 시 AI가 비즈로직·SQL까지 **소스로 직접 회귀(JIT)** 가능. (BEFORE는 controller만 있어 SQL/로직 누락)

### 2. 본문 비즈규칙 (4-3 abstract + 4-2 코드값 의도)
AFTER는 비즈규칙이 **간결한 abstract + 코드값 의미**로:
```
- 데이터 필터링: 삭제되지 않은 데이터(DEL_YN='N')만 조회
- 결재 상태: CTR_APP_TP_CD='10'(결재 진행 중)이고 APPR_INQ_YN='Y'(결재자 조회)만
- 계약 유형: CTR_CLSF_CD '00'(직매입자체보관),'10'(직매입위탁),'20'(특약매입자체보관)...
```
→ 소스만 보면 `'10'`,`'00'`이 뭔지 모르는데, **코드 의미가 복원**되어 쿼리 의도가 읽힘.

### 3. 변경 안 된 것 (하위호환)
`inf-id / method / path / domain / tables` frontmatter는 동일 → 뷰어·그래프·JIT 무파괴.

## 검증으로 잡은 버그
`eval_anchor_coverage`가 Windows 절대경로 `D:`의 콜론에서 stage 분류 깨짐 → 정규식 수정(커밋 ce7513b). 검증 안 했으면 못 잡았을 결함.
