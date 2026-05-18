#!/usr/bin/env node
/**
 * ua_req_bridge.js — knowledge-graph.json + SI 스펙 파싱 → si-graph.json
 * 사용법: node ua_req_bridge.js [project-root]
 *
 * - linked-req-cache.json 키는 `src/a.ts`(상대경로) 또는 `file:src/a.ts` 형태 모두 허용.
 * - 그래프 노드 id가 `node-xxx` 이고 `filePath`가 있으면 filePath로 매핑한다.
 * - 출력 전 @understand-anything/core 의 validateGraph로 스키마 정규화(가능한 경우).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const uaDir = path.join(projectRoot, ".understand-anything");
const uaGraphPath = path.join(uaDir, "knowledge-graph.json");
const siGraphPath = path.join(uaDir, "si-graph.json");
const linkedReqCachePath = path.join(uaDir, "linked-req-cache.json");

const coreDistPath = path.resolve(
  __dirname,
  "../ua/packages/core/dist/index.js"
);

if (!fs.existsSync(coreDistPath)) {
  console.error(`오류: UA core가 빌드되지 않았습니다. 먼저 실행하세요:`);
  console.error(
    `  cd plugins/speclinker/ua && pnpm --filter @understand-anything/core build`
  );
  process.exit(1);
}

function normalizeRelPath(p) {
  if (typeof p !== "string") return "";
  let s = p.replace(/\\/g, "/").trim();
  if (s.toLowerCase().startsWith("file:")) s = s.slice(5);
  return s.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

/** knowledge-graph.project 가 문자열·불완전 객체여도 spread 안전한 객체로 만든다. */
function normalizeProject(project, fallbackName) {
  const base = {
    name: fallbackName,
    languages: [],
    frameworks: [],
    description: "",
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "unknown",
  };
  if (typeof project === "string") {
    return { ...base, name: project.trim() || fallbackName };
  }
  if (project && typeof project === "object" && !Array.isArray(project)) {
    return {
      ...base,
      ...project,
      name:
        typeof project.name === "string" && project.name.trim()
          ? project.name
          : fallbackName,
      languages: Array.isArray(project.languages) ? project.languages : [],
      frameworks: Array.isArray(project.frameworks) ? project.frameworks : [],
      description:
        typeof project.description === "string" ? project.description : "",
      analyzedAt:
        typeof project.analyzedAt === "string"
          ? project.analyzedAt
          : base.analyzedAt,
      gitCommitHash:
        typeof project.gitCommitHash === "string"
          ? project.gitCommitHash
          : base.gitCommitHash,
    };
  }
  return base;
}

/** linked-req-cache 키 → knowledge-graph 파일 노드 id */
function buildLinkedReqFileResolver(nodes) {
  const ids = new Set((nodes || []).map((n) => n && n.id).filter(Boolean));
  const byRelPath = new Map();

  for (const n of nodes || []) {
    if (!n || typeof n.id !== "string") continue;
    if (n.id.startsWith("file:")) {
      const rel = normalizeRelPath(n.id.slice(5));
      if (rel) byRelPath.set(rel, n.id);
    }
    if (typeof n.filePath === "string") {
      const rel = normalizeRelPath(n.filePath);
      if (rel) {
        if (!byRelPath.has(rel)) byRelPath.set(rel, n.id);
        byRelPath.set(rel, n.id);
      }
    }
  }

  return function resolveFileNodeId(cacheKey) {
    const rel = normalizeRelPath(cacheKey);
    if (!rel) return null;
    const prefixed = `file:${rel}`;
    if (ids.has(prefixed)) return prefixed;
    if (ids.has(cacheKey)) return cacheKey;
    if (ids.has(rel)) return rel;
    return byRelPath.get(rel) || null;
  };
}

async function main() {
  const { parseSISpecs, validateGraph } = await import(pathToFileURL(coreDistPath).href);

  const fallbackName = path.basename(projectRoot);

  let baseGraph = {
    version: "1.0.0",
    project: normalizeProject(null, fallbackName),
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
  };

  if (fs.existsSync(uaGraphPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(uaGraphPath, "utf-8"));
      baseGraph = {
        ...baseGraph,
        ...raw,
        project: normalizeProject(raw.project, fallbackName),
        nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
        edges: Array.isArray(raw.edges) ? raw.edges : [],
        layers: Array.isArray(raw.layers) ? raw.layers : [],
        tour: Array.isArray(raw.tour) ? raw.tour : [],
      };
      console.log(`knowledge-graph.json 로드: 노드 ${baseGraph.nodes.length}개`);
    } catch (e) {
      console.warn(`knowledge-graph.json 파싱 실패: ${e.message}`);
    }
  }

  const intermediateDir = path.join(uaDir, "intermediate");

  // 문제 1: project 없을 때 domain-analysis.json에서 보완
  if (baseGraph.project.name === fallbackName) {
    const domainAnalysisPath = path.join(intermediateDir, "domain-analysis.json");
    if (fs.existsSync(domainAnalysisPath)) {
      try {
        const da = JSON.parse(fs.readFileSync(domainAnalysisPath, "utf-8"));
        if (da.project) {
          baseGraph.project = normalizeProject(da.project, fallbackName);
          console.log(`project 메타 보완: domain-analysis.json → ${baseGraph.project.name}`);
        }
      } catch (e) {
        console.warn(`domain-analysis.json project 로드 실패: ${e.message}`);
      }
    }
  }

  // 문제 2: layers 없을 때 intermediate/layers.json에서 보완
  if (baseGraph.layers.length === 0) {
    const layersIntPath = path.join(intermediateDir, "layers.json");
    if (fs.existsSync(layersIntPath)) {
      try {
        const rawLayers = JSON.parse(fs.readFileSync(layersIntPath, "utf-8"));
        if (Array.isArray(rawLayers) && rawLayers.length > 0) {
          baseGraph.layers = rawLayers;
          console.log(`layers 보완: intermediate/layers.json → ${rawLayers.length}개 레이어`);
        }
      } catch (e) {
        console.warn(`intermediate/layers.json 로드 실패: ${e.message}`);
      }
    }
  }

  const { nodes: specNodes, edges: specEdges } = parseSISpecs(projectRoot);
  console.log(
    `스펙 파싱: req 노드 ${specNodes.filter((n) => n.type === "req").length}개,` +
      ` srs ${specNodes.filter((n) => n.type === "srs").length}개,` +
      ` tc ${specNodes.filter((n) => n.type === "tc").length}개`
  );

  const baseNodeIds = new Set(baseGraph.nodes.map((n) => n.id));
  const resolveFileNodeId = buildLinkedReqFileResolver(baseGraph.nodes);

  const satisfiesEdges = [];
  if (fs.existsSync(linkedReqCachePath)) {
    const cache = JSON.parse(fs.readFileSync(linkedReqCachePath, "utf-8"));
    const specNodeIds = new Set(specNodes.map((n) => n.id));

    for (const [cacheKey, reqIds] of Object.entries(cache)) {
      const fileNodeId = resolveFileNodeId(cacheKey);
      if (!fileNodeId || !baseNodeIds.has(fileNodeId)) continue;

      for (const reqId of reqIds) {
        const reqNodeId = `req:${reqId}`;
        if (!specNodeIds.has(reqNodeId)) continue;

        satisfiesEdges.push({
          source: fileNodeId,
          target: reqNodeId,
          type: "satisfies",
          direction: "forward",
          weight: 0.8,
        });
      }
    }
    console.log(`satisfies 엣지: ${satisfiesEdges.length}개`);
  } else {
    console.log(`satisfies 엣지: 0개  ← linked-req-cache.json 없음`);
  }

  const testedByEdges = [];
  const tcNodes = specNodes.filter((n) => n.type === "tc");

  for (const tcNode of tcNodes) {
    const linkedReqId = tcNode.siMeta?.linkedReqId;
    if (!linkedReqId) continue;

    const implementingFiles = satisfiesEdges
      .filter((e) => e.target === `req:${linkedReqId}`)
      .map((e) => e.source);

    for (const fileNodeId of implementingFiles) {
      testedByEdges.push({
        source: fileNodeId,
        target: tcNode.id,
        type: "tested_by",
        direction: "forward",
        weight: 0.5,
      });
    }
  }
  console.log(`tested_by 엣지: ${testedByEdges.length}개`);

  const siLayers = [];
  const reqNodeIds = specNodes
    .filter((n) => n.type === "req")
    .map((n) => n.id);
  const srsNodeIds = specNodes
    .filter((n) => n.type === "srs")
    .map((n) => n.id);
  const tcNodeIds = specNodes.filter((n) => n.type === "tc").map((n) => n.id);

  if (reqNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-requirements",
      name: "요구사항 (RD)",
      description: "REQ-F/REQ-NF 요구사항 정의서 항목",
      nodeIds: reqNodeIds,
    });
  }
  if (srsNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-specs",
      name: "기능 명세 (SRS)",
      description: "SRS-F 기능 명세서 항목",
      nodeIds: srsNodeIds,
    });
  }
  if (tcNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-tests",
      name: "테스트케이스 (TC)",
      description: "TC-F/TC-NF 테스트케이스 항목",
      nodeIds: tcNodeIds,
    });
  }
  const uisNodeIds = specNodes.filter((n) => n.type === "uis").map((n) => n.id);
  if (uisNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-screens",
      name: "화면 설계 (UIS)",
      description: "UIS-F 화면·플로우 설계 (docs/05_설계서/UI_Spec)",
      nodeIds: uisNodeIds,
    });
  }
  // 인터페이스 스펙 레이어 (REQ→INF traces_to, UIS→INF calls) — 1 INF = 1 HTTP 메소드
  const infNodeIds = specNodes.filter((n) => n.type === "inf").map((n) => n.id);
  if (infNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-inf",
      name: "인터페이스 설계 (INF)",
      description: "INF-XXX 메소드 단위 인터페이스 (docs/05_설계서/API_Design.md)",
      nodeIds: infNodeIds,
    });
  }
  // DB 스키마 레이어 (API→SCH reads_from)
  const schNodeIds = specNodes.filter((n) => n.type === "sch").map((n) => n.id);
  if (schNodeIds.length > 0) {
    siLayers.push({
      id: "layer:si-schema",
      name: "DB 스키마 (SCH)",
      description: "SCH-XXX 테이블·스키마 스펙 (docs/05_설계서/DB_Schema.md)",
      nodeIds: schNodeIds,
    });
  }

  const mergedProject = normalizeProject(baseGraph.project, fallbackName);
  let siGraph = {
    ...baseGraph,
    project: {
      ...mergedProject,
      siGeneratedAt: new Date().toISOString(),
    },
    nodes: [...baseGraph.nodes, ...specNodes],
    edges: [...baseGraph.edges, ...specEdges, ...satisfiesEdges, ...testedByEdges],
    layers: [...(baseGraph.layers || []), ...siLayers],
  };

  const validated = validateGraph(siGraph);
  if (validated.success && validated.data) {
    siGraph = {
      ...validated.data,
      project: {
        ...validated.data.project,
        siGeneratedAt: new Date().toISOString(),
      },
    };
    if (validated.issues?.length) {
      console.log(
        `그래프 검증: ${validated.issues.length}건 이슈(자동 보정/삭제) — 대시보드용 정규화 출력`
      );
    }
  } else {
    console.warn(
      `경고: validateGraph 실패 — 부분 병합 그래프를 그대로 저장합니다: ${validated.fatal || ""}`
    );
  }

  fs.mkdirSync(uaDir, { recursive: true });
  fs.writeFileSync(siGraphPath, JSON.stringify(siGraph, null, 2));

  console.log(`\nsi-graph.json 생성 완료: ${siGraphPath}`);
  console.log(`  전체 노드: ${siGraph.nodes.length}개`);
  console.log(`  전체 엣지: ${siGraph.edges.length}개`);
  console.log(`  레이어: ${siGraph.layers.length}개`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
