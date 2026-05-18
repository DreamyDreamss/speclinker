import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseSISpecs } from "../plugins/parsers/si-spec-parser";

// ---------------------------------------------------------------------------
// 픽스처: docs/ 하위 전체 체인
// REQ-F-001 → SRS-F-001 → UIS-F-001 → INF-001 → SCH-001
//          └→ TC-F-001
// ---------------------------------------------------------------------------
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "si-chain-test-"));
  fs.mkdirSync(path.join(tmpDir, "docs", "01_RD"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "docs", "03_SRS"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "docs", "07_TC"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "docs", "05_DDD", "screens"), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "docs", "01_RD", "RD_v1.0.md"), `
| REQ-ID | 요구사항명 | 우선순위 |
|--------|-----------|---------|
| REQ-F-001 | 사용자 로그인 | High |
| REQ-F-002 | 대시보드 조회 | Medium |
`);

  fs.writeFileSync(path.join(tmpDir, "docs", "03_SRS", "SRS_v1.0.md"), `
| SRS-ID | 기능명 | REQ-ID |
|--------|--------|--------|
| SRS-F-001 | 이메일 로그인 | REQ-F-001 |
`);

  fs.writeFileSync(path.join(tmpDir, "docs", "07_TC", "TC_v1.0.md"), `
| TC-ID | 테스트명 | REQ-ID |
|-------|---------|--------|
| TC-F-001 | 로그인 정상 | REQ-F-001 |
`);

  // UI_Spec: UIS 색인 (3열: UIS-F / 화면명 / REQ)
  fs.writeFileSync(path.join(tmpDir, "docs", "05_DDD", "UI_Spec_v1.0.md"), `
| UIS-ID | 화면명 | REQ-ID |
|--------|--------|--------|
| UIS-F-001 | 로그인 화면 | REQ-F-001 |
`);

  // screens/: UIS→INF calls 링크 (2열: UIS-F / INF)
  fs.writeFileSync(path.join(tmpDir, "docs", "05_DDD", "screens", "UIS-F-001.md"), `
## 사용 API (INF)

| UIS-F-001 | INF-001 |
| UIS-F-001 | INF-002 |
`);

  // API_Design: INF 색인 — 1행 = 1 HTTP 메소드(인터페이스 1건)
  fs.writeFileSync(path.join(tmpDir, "docs", "05_DDD", "API_Design.md"), `
## INF 색인 (인터페이스 목록)

| INF-ID | 엔드포인트·메소드명 | REQ-ID |
|--------|-----------------|--------|
| INF-001 | POST /auth/login — 로그인 처리 | REQ-F-001 |
| INF-002 | DELETE /auth/sessions — 로그아웃 | REQ-F-001 |
| INF-003 | GET /dashboard/summary — 요약 조회 | REQ-F-002 |
`);

  // DB_Schema: SCH 색인 — 3열은 주요 연결 INF-ID
  fs.writeFileSync(path.join(tmpDir, "docs", "05_DDD", "DB_Schema.md"), `
## 스키마 색인

| SCH-ID | 테이블명 | INF-ID |
|--------|---------|--------|
| SCH-001 | users | INF-001 |
| SCH-002 | sessions | INF-001 |
| SCH-003 | dashboard_stats | INF-003 |
`);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseSISpecs — 전체 스펙 체인 (INF 기반)", () => {
  it("REQ 노드를 생성한다", () => {
    const { nodes } = parseSISpecs(tmpDir);
    const reqs = nodes.filter(n => n.type === "req");
    expect(reqs).toHaveLength(2);
    expect(reqs.find(n => n.id === "req:REQ-F-001")).toBeDefined();
  });

  it("SRS 노드와 REQ→SRS traces_to 엣지를 생성한다", () => {
    const { nodes, edges } = parseSISpecs(tmpDir);
    expect(nodes.filter(n => n.type === "srs")).toHaveLength(1);
    expect(edges).toContainEqual(expect.objectContaining({
      source: "req:REQ-F-001", target: "req:SRS-F-001", type: "traces_to",
    }));
  });

  it("TC 노드를 생성한다", () => {
    const { nodes } = parseSISpecs(tmpDir);
    expect(nodes.filter(n => n.type === "tc")).toHaveLength(1);
  });

  it("UIS 노드와 REQ→UIS traces_to 엣지를 생성한다", () => {
    const { nodes, edges } = parseSISpecs(tmpDir);
    expect(nodes.filter(n => n.type === "uis")).toHaveLength(1);
    expect(edges).toContainEqual(expect.objectContaining({
      source: "req:REQ-F-001", target: "req:UIS-F-001", type: "traces_to",
    }));
  });

  it("INF 노드를 메소드 단위로(1행=1노드) 생성한다", () => {
    const { nodes } = parseSISpecs(tmpDir);
    const infs = nodes.filter(n => n.type === "inf");
    expect(infs).toHaveLength(3);
    expect(infs.find(n => n.id === "req:INF-001")).toBeDefined();
    expect(infs.find(n => n.id === "req:INF-002")).toBeDefined();
    expect(infs.find(n => n.id === "req:INF-003")).toBeDefined();
  });

  it("REQ→INF traces_to 엣지를 생성한다", () => {
    const { edges } = parseSISpecs(tmpDir);
    expect(edges).toContainEqual(expect.objectContaining({
      source: "req:REQ-F-001", target: "req:INF-001", type: "traces_to",
    }));
    expect(edges).toContainEqual(expect.objectContaining({
      source: "req:REQ-F-002", target: "req:INF-003", type: "traces_to",
    }));
  });

  it("SCH 노드와 INF→SCH reads_from 엣지를 생성한다", () => {
    const { nodes, edges } = parseSISpecs(tmpDir);
    const schs = nodes.filter(n => n.type === "sch");
    expect(schs).toHaveLength(3);
    const schEdges = edges.filter(e => e.type === "reads_from");
    expect(schEdges).toHaveLength(3);
    expect(schEdges).toContainEqual(expect.objectContaining({
      source: "req:INF-001", target: "req:SCH-001", type: "reads_from",
    }));
  });

  it("UIS→INF calls 엣지를 screens/ 파일에서 생성한다", () => {
    const { edges } = parseSISpecs(tmpDir);
    const callsEdges = edges.filter(e => e.type === "calls");
    expect(callsEdges).toHaveLength(2);
    expect(callsEdges).toContainEqual(expect.objectContaining({
      source: "req:UIS-F-001", target: "req:INF-001", type: "calls",
    }));
    expect(callsEdges).toContainEqual(expect.objectContaining({
      source: "req:UIS-F-001", target: "req:INF-002", type: "calls",
    }));
  });

  it("전체 체인 REQ→SRS, REQ→UIS, REQ→INF, UIS→INF(calls), INF→SCH(reads_from) 모두 존재", () => {
    const { edges } = parseSISpecs(tmpDir);
    const byType = (t: string) => edges.filter(e => e.type === t);
    // traces_to: SRS(1) + UIS(1) + INF(3) = 5개
    expect(byType("traces_to").length).toBe(5);
    expect(byType("calls").length).toBe(2);
    expect(byType("reads_from").length).toBe(3);
  });
});

describe("parseSISpecs — 분할 레이아웃 (docs/ 하위)", () => {
  let splitDir: string;
  beforeAll(() => {
    splitDir = fs.mkdtempSync(path.join(os.tmpdir(), "si-split-"));
    fs.mkdirSync(path.join(splitDir, "docs", "01_RD", "req"), { recursive: true });
    fs.mkdirSync(path.join(splitDir, "docs", "03_SRS", "srs"), { recursive: true });
    fs.mkdirSync(path.join(splitDir, "docs", "07_TC"), { recursive: true });

    fs.writeFileSync(path.join(splitDir, "docs", "01_RD", "RD_v1.0.md"), `
| REQ-ID | 요구사항명 | 우선순위 |
|--------|-----------|---------|
| REQ-F-001 | [로그인 색인](req/REQ-F-001.md) | High |
`);
    fs.writeFileSync(path.join(splitDir, "docs", "01_RD", "req", "REQ-F-001.md"), `
| REQ-ID | 요구사항명 | 우선순위 |
|--------|-----------|---------|
| REQ-F-001 | 중복 행은 스킵 | Low |
`);
    fs.writeFileSync(path.join(splitDir, "docs", "03_SRS", "SRS_v1.0.md"), `
| SRS-ID | 기능명 | REQ-ID |
|--------|--------|--------|
| SRS-F-001 | 로그인 명세 | REQ-F-001 |
`);
    fs.writeFileSync(path.join(splitDir, "docs", "07_TC", "TC_v1.0.md"), `
| TC-ID | 테스트명 | REQ-ID |
|-------|---------|--------|
| TC-F-001 | 로그인 | REQ-F-001 |
`);
  });
  afterAll(() => { fs.rmSync(splitDir, { recursive: true, force: true }); });

  it("RD_v1.0.md가 동일 REQ-ID와 충돌할 때 우선한다", () => {
    const { nodes } = parseSISpecs(splitDir);
    const r = nodes.find(n => n.id === "req:REQ-F-001" && n.type === "req");
    expect(r).toBeDefined();
    expect(r!.filePath).toBe("docs/01_RD/RD_v1.0.md");
    expect(r!.name).toContain("로그인 색인");
  });
});
