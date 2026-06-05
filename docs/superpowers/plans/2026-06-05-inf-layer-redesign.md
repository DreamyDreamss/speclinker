# INF 레이어 재설계 구현 플랜

> REQUIRED SUB-SKILL: executing-plans. TDD. 단계별 커밋/푸시.

**Goal:** 소스=진실 / 스펙=소비자별 레이어. 5컴포넌트: full-chain 앵커, 코드값 의도복원, 본문 분리, 앵커 커버리지 측정, C 내러티브.

**상위 설계서:** `docs/superpowers/specs/2026-06-05-inf-layer-redesign-design.md`

**불변식:** INF/SCH 경로·핵심 frontmatter(inf-id/method/path/tables) 무변경(뷰어·그래프·JIT 무파괴). 하위호환(기존 `## 근거 소스` 병기). 2스택 검증.

**영향:** /sl-recon(생성), /sl-recon-doc(내러티브), /sl-change·/sl-aidd(소비). 에이전트 ddd-api/db. 스크립트 spec_graph_build·scan_code_literals(신규)·eval_anchor_coverage(신규).

**순서:** 4-1 → 4-2 → 4-4 → 4-3 → 4-5 (4-1이 키스톤·입력).

---

## Task 4-1: full-chain 앵커

INF가 controller만이 아니라 service/DAO/mapper 체인 전체를 앵커로 기록. spec_graph_build가 array `anchors:` frontmatter도 읽도록.

**Files:** `agents/ddd-api-agent.md`(앵커 지침), `templates/*INF*`(있으면), `scripts/spec_graph_build.py`(array 앵커 파싱), `scripts/tests/test_change_context.py`(회귀)

- [ ] **Step 1: spec_graph_build가 frontmatter `anchors:` 배열 읽도록 (실패테스트)**

`test_change_context.py`에 추가: frontmatter `anchors:` 배열(체인 3단계)을 가진 INF → `graph['inf'][id]['anchors']`에 3개 다 포함.
```python
def test_frontmatter_anchors():
    import spec_graph_build as g
    tmp = tempfile.mkdtemp()
    try:
        p = os.path.join(tmp, 'docs/05_설계서/order/INF'); os.makedirs(p, exist_ok=True)
        open(os.path.join(p, 'INF-ORD-001.md'),'w',encoding='utf-8').write(
            "---\ninf-id: INF-ORD-001\nmethod: POST\npath: /o\ndomain: order\n"
            "tables:\n  - ORDERS\nanchors:\n  - src/C.java:1-9\n  - src/S.java:2-8\n  - src/M.xml:3-30\n---\n# x\n")
        gr = g.build_graph(tmp)
        a = gr['inf']['INF-ORD-001']['anchors']
        assert any('C.java' in x for x in a) and any('S.java' in x for x in a) and any('M.xml' in x for x in a), a
        print('PASS: test_frontmatter_anchors')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```
`__main__`에 추가.

- [ ] **Step 2: 실패 확인** — 현재 `_anchors()`는 본문만 파싱 → frontmatter anchors 미반영.

- [ ] **Step 3: spec_graph_build `_frontmatter`/`build_graph` 확장**

`build_graph`의 INF 처리에서 frontmatter `anchors`(배열)를 본문 `_anchors(body)`와 합친다:
```python
        fm_anchors = fm.get('anchors') or []
        body_anchors = _anchors(body)
        all_anchors = list(dict.fromkeys([*fm_anchors, *body_anchors]))
        graph['inf'][iid] = {..., 'anchors': all_anchors, ...}
```
(`_frontmatter`는 이미 배열 파싱 지원 — `anchors:` 다음 `  - ` 리스트.)

- [ ] **Step 4: 통과 확인** — test_change_context.py 전체 PASS.

- [ ] **Step 5: ddd-api-agent에 full-chain 앵커 지침**

`agents/ddd-api-agent.md`에 추가(INF 작성 규칙): frontmatter에 `anchors:` 배열로 **사용한 체인 파일 전부**(controller 진입 + service 비즈로직 + DAO/mapper SQL)를 `경로:라인` 형식으로 기록. 기존 `## 근거 소스`(controller)도 병기(하위호환). dispatch_inf_gen이 전달하는 relatedFiles(service/dao/query)를 앵커 출처로 사용.

- [ ] **Step 6: 커밋/푸시**
```
git add scripts/spec_graph_build.py scripts/tests/test_change_context.py agents/ddd-api-agent.md
git commit -m "feat(4-1): full-chain anchors — spec_graph reads frontmatter anchors[]; ddd-api-agent emits chain anchors"
git push
```

---

## Task 4-2: 코드값 → 쿼리 의도 복원

`scan_code_literals.py`: 앵커 SQL에서 코드 리터럴 + 소스 JT_CODE 그룹신호 추출. (DB/MCP 해소는 ddd-db-agent enrichment가 수행 — 스크립트는 스캔까지.)

**Files:** `scripts/scan_code_literals.py`(신규), `scripts/tests/test_code_literals.py`(신규), `agents/ddd-db-agent.md`(해소 지침 강화)

- [ ] **Step 1: 실패테스트** (`test_code_literals.py`)
```python
def test_scan_literals():
    import scan_code_literals as s
    sql = ("SELECT * FROM ORD_M WHERE PRD_APP_STS_CD = '20' AND USE_YN='Y' "
           "AND ORD_TP IN ('01','02') "
           "AND (SELECT CODE_NM FROM JT_CODE WHERE CODE_GRP_ID='PRD_APP_STS' AND CODE=A.PRD_APP_STS_CD) IS NOT NULL")
    lits = s.scan_sql(sql)
    by = {l['column']: l for l in lits}
    assert '20' in by['PRD_APP_STS_CD']['values'], by
    assert by['PRD_APP_STS_CD'].get('group') == 'PRD_APP_STS', by  # 소스 JT_CODE 패턴서 그룹 복원
    assert set(by['ORD_TP']['values']) >= {'01','02'}, by
    print('PASS: test_scan_literals')
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: scan_code_literals.py 구현**

핵심 로직:
- 코드 리터럴: `regex (\w*(?:_CD|_TP|_STS|_YN|_GB|_FL|_DIV))\s*(?:=|<>|!=)\s*'([^']{1,12})'` + `IN ('..','..')`.
- 그룹신호(소스 정적): `JT_CODE\s+WHERE\s+CODE_GRP_ID\s*=\s*'([^']+)'\s+AND\s+CODE\s*=\s*\w*\.(\w+)` → `{컬럼: 그룹}` 매핑.
- 산출: `[{column, values:[], group?(소스서 복원), file?}]`. CLI는 파일/디렉토리 받아 `_tmp/code_literals.json` 저장.

- [ ] **Step 4: 통과 확인.**

- [ ] **Step 5: ddd-db-agent 코드값 해소 지침 강화**

enrichment 모드에 `_tmp/code_literals.json` 활용: ① group 알면 DB/MCP로 `JT_CODE WHERE CODE_GRP_ID=group` 전체 값·명 조회 ② group 모르면 `WHERE CODE IN (values)` probe → 그룹 추론(모호 `[후보]`) ③ JT_CODE 없으면 소스 enum/상수 ④ 미해소 `[미확인]`. SCH 코드값 + INF "쿼리 의도" 주석에 **출처(JT_CODE.그룹) 표기** 주입.

- [ ] **Step 6: 커밋/푸시**

---

## Task 4-4: 앵커 커버리지 측정 (eval_fidelity 대체)

**Files:** `scripts/eval_anchor_coverage.py`(신규), `scripts/tests/test_anchor_coverage.py`(신규)

- [ ] **Step 1: 실패테스트** — INF 중 앵커가 controller만 vs 체인3단계 → 커버리지 0.33 vs 1.0, 메타(method/path) 일치율.

- [ ] **Step 2~4: 구현·통과**

`eval_anchor_coverage.py`:
- **앵커 체인 커버리지**: 각 INF 앵커 확장자/경로로 단계 분류(controller/service/dao|mapper). 가진 단계 수 / 기대 단계(체인 깊이, source_index/resolve_call_chain 참조 가능시).
- **메타 정확도**: frontmatter method/path가 라우트와, tables가 앵커 SQL 테이블과 일치하는 비율.
- **코드값 해소율**: code_literals 중 의미 채워진 비율(있으면).
- 출력 `docs/report/eval/anchor_coverage.json` + 콘솔 요약.

- [ ] **Step 5: eval_fidelity 폐기 표시** — `eval_fidelity.py` 상단에 `# DEPRECATED: 앵커커버리지(eval_anchor_coverage)로 대체. self-consistency 프록시는 충실도 아님.` + fidelity-findings.md에 "프록시였음" 정정 1줄.

- [ ] **Step 6: 커밋/푸시**

---

## Task 4-3: 본문 분리 (abstract + 사람설명)

**Files:** `agents/ddd-api-agent.md`(abstract 지침)

- [ ] **Step 1:** ddd-api-agent에 — INF 본문 비즈규칙을 **짧은 abstract(1~3줄 "무엇을 하나")**로(완전 정본 주장 제거). 상세 진실은 앵커. 단, 코드값 의도(4-2)는 포함(이해 도움).
- [ ] **Step 2:** "이 INF는 완전한 사양이 아니라 현행 요약 + 앵커 인덱스" 1줄 명시.
- [ ] **Step 3: 커밋/푸시**

---

## Task 4-5: C 내러티브 정식화

**Files:** `scripts/build_domain_overview.py`(기능단위 설명 추가), `skills/sl-recon-doc/SKILL.md`(정식 STEP)

- [ ] **Step 1:** build_domain_overview에 기능단위 사람설명 옵션 — INF별 "이 기능은 무엇을(코드의미 주입)" 짧은 설명을 도메인 개요에 묶거나 별도 섹션.
- [ ] **Step 2:** sl-recon-doc에 STEP 추가 — `build_domain_overview.py` 호출(도메인 개요 = 사람 SOP 레이어). 기계 인덱스와 분리 명시.
- [ ] **Step 3: 커밋/푸시**

---

## Task 4-6: 통합 검증 + doc-sync

- [ ] nkshop INF 1개 재생성은 비용 크므로 **스크립트 단위 검증 위주**: spec_graph_build array앵커, scan_code_literals on nkshop SQL(실 그룹신호 복원 확인), eval_anchor_coverage 동작.
- [ ] doc-sync: scripts/README(신규 2), CLAUDE 버전노트 v3.8.0, RECON_PIPELINE(앵커·코드값·내러티브), 전체 단위테스트 회귀.
- [ ] 커밋/푸시.

## DoD
- [ ] full-chain 앵커(frontmatter array) + spec_graph 읽기 + ddd-api 지침.
- [ ] scan_code_literals(소스 그룹신호) + ddd-db 해소지침 + 출처표기.
- [ ] eval_anchor_coverage가 eval_fidelity 대체.
- [ ] INF 본문 abstract화, 사람 내러티브 정식 STEP.
- [ ] 하위호환·2스택·doc-sync·전체 테스트 PASS.
