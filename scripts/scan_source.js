#!/usr/bin/env node
/**
 * scan_source.js — Tree-sitter 불필요한 경량 소스 스캐너
 *
 * UA knowledge-graph 대체. annotation/decorator 기반 정적 분석으로
 * 컨트롤러·서비스·DAO·배치 파일을 탐지하고 라우트를 추출한다.
 *
 * Usage:
 *   node scan_source.js --workspace=. [--out=_tmp/source_index.json]
 *
 * 지원 언어/프레임워크:
 *   Java   — Spring MVC (@RestController, @Service, @Repository, @Mapper, ...)
 *   Kotlin — Spring (@RestController, ...)
 *   Python — FastAPI (@router.get), Flask (@app.route), Django (urlpatterns)
 *   TypeScript/JS — NestJS (@Controller, @Get), Express (router.get)
 *
 * 출력: _tmp/source_index.json
 *   { scannedAt, workspace, langStats, files: [...] }
 *
 * 각 file 항목:
 *   { filePath, lang, package, className, type, annotations,
 *     routes, imports, injected }
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}

const WORKSPACE = path.resolve(arg('workspace', process.cwd()));
const OUT_PATH  = path.resolve(arg('out', path.join(WORKSPACE, '_tmp', 'source_index.json')));

// ── 언어 감지 ────────────────────────────────────────────────────────────────

const LANG_BY_EXT = {
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.py': 'python',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.go': 'go', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', 'dist', '.gradle',
  '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode',
  'out', 'bin', 'obj', '.next', '.nuxt', 'coverage',
]);

// ── 소스 파일 수집 ───────────────────────────────────────────────────────────

function collectFiles(dir, result = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return result; }

  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectFiles(full, result);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (LANG_BY_EXT[ext]) result.push({ fullPath: full, ext });
    }
  }
  return result;
}

// ── Java / Kotlin 파서 ───────────────────────────────────────────────────────

/**
 * @Controller 메서드 바디 추출 — annotIndex 이후 첫 '{' 부터 매칭 '}' 까지.
 * 중괄호 depth 카운팅으로 중첩 클래스·람다도 안전하게 처리.
 */
function extractMethodBody(content, annotIndex) {
  let i = annotIndex;
  let parenDepth = 0;

  // 어노테이션·메서드 시그니처를 지나 첫 '{' 탐지
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '{' && parenDepth === 0) break;
    else if (ch === ';' && parenDepth === 0) return ''; // abstract/interface
    i++;
  }
  if (i >= content.length) return '';

  // 중괄호 depth 카운팅으로 바디 추출
  let depth = 0;
  const start = i;
  for (let j = i; j < content.length; j++) {
    const ch = content[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return content.slice(start, j + 1); }
  }
  return '';
}

// jwork + Spring 범용 JSON 응답 시그널 — 메서드 바디 안에서 이 중 하나라도 있으면 api
// ※ @ResponseBody는 바디 외부(선언부)에 있으므로 별도 탐지 (CLASS_RESPONSE_BODY / METHOD_RESPONSE_BODY)
const API_BODY_SIGNALS = /GridResultUtil|AjaxMessageMapRenderer|ResponseEntity/;
const METHOD_RESPONSE_BODY = /@ResponseBody/;

const JAVA_CTRL_ANNOTS = [
  '@RestController', '@Controller', '@RequestMapping',
  '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping',
];
const JAVA_SVC_ANNOTS  = ['@Service', '@Component', '@EventListener'];
const JAVA_DAO_ANNOTS  = ['@Repository', '@Mapper', '@Dao'];
const JAVA_BATCH_NAMES = /batch|job|scheduler|task|worker|consumer|processor|jobbean|step/i;
const JAVA_BATCH_DIRS  = /batch|job|jobs|scheduler|schedule/i;

function parseJava(content, filePath) {
  const annotations = [];
  const routes      = [];
  const imports     = [];
  const injected    = [];
  let pkg = '', className = '';

  // package
  const pkgM = content.match(/^package\s+([\w.]+)\s*;/m);
  if (pkgM) pkg = pkgM[1];

  // class name
  const clsM = content.match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/);
  if (clsM) className = clsM[1];

  // annotations (class-level: 클래스 선언 앞 100줄 이내)
  const classPos  = content.search(/(?:public\s+)?(?:abstract\s+)?class\s+\w+/);
  const preClass  = classPos > 0 ? content.slice(Math.max(0, classPos - 3000), classPos) : content.slice(0, 3000);
  const annotPat  = /@[\w]+(?:\([^)]*\))?/g;
  let m;
  while ((m = annotPat.exec(preClass)) !== null) annotations.push(m[0]);

  // class-level @RequestMapping path
  let baseMapping = '';
  const baseMM = preClass.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
  if (baseMM) baseMapping = baseMM[1];

  // @RestController 또는 클래스 수준 @ResponseBody이면 전체 api
  const isRestController     = annotations.some(a => /^@RestController(\(|$)/.test(a));
  const isClassResponseBody  = annotations.some(a => /^@ResponseBody(\(|$)/.test(a));
  const isAllApi = isRestController || isClassResponseBody;

  // method-level HTTP mappings
  const methodPat = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
  while ((m = methodPat.exec(content)) !== null) {
    const verb     = m[1] === 'Request' ? 'ANY' : m[1].toUpperCase();
    const subPath  = m[2];
    const fullPath = (baseMapping + '/' + subPath).replace(/\/+/g, '/');
    // find method name after annotation
    const afterAnnot = content.slice(m.index, m.index + 300);
    const handlerM  = afterAnnot.match(/(?:public|private|protected)?\s+\w+\s+(\w+)\s*\(/);

    let kind = 'api';
    if (!isAllApi) {
      // @Controller (클래스 수준 @ResponseBody 없음): 메서드별 판별
      // 1. 메서드 선언부(@ResponseBody 어노테이션)
      const declArea = content.slice(Math.max(0, m.index - 300), m.index + 50);
      // 2. 메서드 바디 (GridResultUtil, AjaxMessageMapRenderer, ResponseEntity)
      const body = extractMethodBody(content, m.index);
      if (METHOD_RESPONSE_BODY.test(declArea) || API_BODY_SIGNALS.test(body)) {
        kind = 'api';
      } else {
        kind = 'form';
      }
    }

    routes.push({ method: verb, path: fullPath, handlerMethod: handlerM ? handlerM[1] : '', kind });
  }

  // imports
  const importPat = /^import\s+([\w.]+(?:\.\w+)*)\s*;/gm;
  while ((m = importPat.exec(content)) !== null) imports.push(m[1]);

  // @Autowired / constructor injection
  const injPat = /@Autowired[^;]*?(?:private|protected|public)?\s+(\w+)\s+\w+\s*;/gs;
  while ((m = injPat.exec(content)) !== null) injected.push(m[1]);
  // constructor injection
  const ctorInjPat = /(?:public\s+\w+)\s*\(([^)]+)\)/;
  const ctorM = content.match(ctorInjPat);
  if (ctorM) {
    const params = ctorM[1].split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
    params.forEach(p => { if (p && !injected.includes(p)) injected.push(p); });
  }

  // type 결정
  const fp   = filePath.replace(/\\/g, '/').toLowerCase();
  const bn   = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const hasA = (arr) => annotations.some(a => arr.some(x => a.toLowerCase().startsWith(x.toLowerCase())));

  let type = 'other';
  if (hasA(JAVA_DAO_ANNOTS) || /dao|mapper|repository/i.test(className))
    type = 'dao';
  else if (hasA(JAVA_SVC_ANNOTS) || /service/i.test(className))
    type = 'service';
  else if (hasA(JAVA_CTRL_ANNOTS))
    type = 'controller';
  else if (JAVA_BATCH_NAMES.test(bn) || JAVA_BATCH_DIRS.test(fp))
    type = 'batch';

  return { pkg, className, annotations: [...new Set(annotations)], routes, imports, injected, type };
}

// ── Python 파서 ───────────────────────────────────────────────────────────────

function parsePython(content, filePath) {
  const annotations = [];
  const routes      = [];
  const imports     = [];
  let className = '';

  // class name
  const clsM = content.match(/^class\s+(\w+)/m);
  if (clsM) className = clsM[1];

  // decorators
  const decPat = /^@([\w.]+(?:\.[a-zA-Z_]+)*(?:\([^)]*\))?)/gm;
  let m;
  while ((m = decPat.exec(content)) !== null) annotations.push('@' + m[1]);

  // Flask/FastAPI routes
  const routePat = /@(?:app|router|bp|blueprint)\.(?:route|get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g;
  while ((m = routePat.exec(content)) !== null) {
    const after = content.slice(m.index, m.index + 200);
    const verbM = after.match(/methods\s*=\s*\[['"](\w+)['"]/);
    const handlerM = after.match(/^def\s+(\w+)/m);
    routes.push({
      method: verbM ? verbM[1].toUpperCase() : m[0].split('.')[1].toUpperCase(),
      path: m[1],
      handlerMethod: handlerM ? handlerM[1] : '',
      kind: 'api',
    });
  }

  // Django urlpatterns
  if (/urlpatterns\s*=/.test(content)) {
    const urlPat = /path\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = urlPat.exec(content)) !== null)
      routes.push({ method: 'ANY', path: m[1], handlerMethod: '', kind: 'api' });
  }

  // imports
  const impPat = /^(?:from\s+([\w.]+)\s+)?import\s+([\w,\s*]+)/gm;
  while ((m = impPat.exec(content)) !== null)
    imports.push((m[1] ? m[1] + '.' : '') + m[2].trim());

  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  const bn = path.basename(filePath, path.extname(filePath)).toLowerCase();
  let type = 'other';
  if (/views?|controller|handler/i.test(bn) || routes.length)
    type = 'controller';
  else if (/service/i.test(bn))
    type = 'service';
  else if (/repositor|dao|model/i.test(bn))
    type = 'dao';
  else if (/batch|job|task|worker/i.test(bn) || /batch|jobs?/i.test(fp))
    type = 'batch';

  return { pkg: '', className, annotations: [...new Set(annotations)], routes, imports, injected: [], type };
}

// ── TypeScript / JavaScript 파서 ─────────────────────────────────────────────

function parseTypeScript(content, filePath) {
  const annotations = [];
  const routes      = [];
  const imports     = [];
  const injected    = [];
  let className = '';

  // class name
  const clsM = content.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
  if (clsM) className = clsM[1];

  // TS decorators
  const decPat = /@([\w]+(?:\([^)]*\))?)/g;
  const preClass = content.slice(0, content.search(/class\s+\w+/) + 200 || 3000);
  let m;
  while ((m = decPat.exec(preClass)) !== null) annotations.push('@' + m[1]);

  // NestJS method decorators
  const nestPat = /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]?([^'"`)\s]*)['"`]?\s*\)/g;
  while ((m = nestPat.exec(content)) !== null) {
    const base = (annotations.find(a => /^@Controller/.test(a)) || '').replace(/@Controller\(['"`]?/, '').replace(/['"`]\)$/, '');
    const full = (base + '/' + m[2]).replace(/\/+/g, '/') || '/' + m[2];
    const after = content.slice(m.index, m.index + 200);
    const handlerM = after.match(/(?:async\s+)?(\w+)\s*\(/);
    routes.push({ method: m[1].toUpperCase(), path: full, handlerMethod: handlerM ? handlerM[1] : '', kind: 'api' });
  }

  // Express router.get/post/...
  const expPat = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = expPat.exec(content)) !== null)
    routes.push({ method: m[1].toUpperCase(), path: m[2], handlerMethod: '', kind: 'api' });

  // imports
  const impPat = /^import\s+.+\s+from\s+['"`]([^'"`]+)['"`]/gm;
  while ((m = impPat.exec(content)) !== null) imports.push(m[1]);

  // @Inject / constructor
  const injPat = /(?:@Inject\(\)\s*)?(?:private|protected|public)\s+(?:readonly\s+)?(\w+):\s*(\w+)/g;
  while ((m = injPat.exec(content)) !== null) injected.push(m[2]);

  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  const bn = path.basename(filePath, path.extname(filePath)).toLowerCase();
  let type = 'other';
  if (/@Controller|@RestController/i.test(annotations.join('')) || routes.length > 0 || /controller|handler|route/i.test(bn))
    type = 'controller';
  else if (/@Injectable|@Service/i.test(annotations.join('')) || /service/i.test(bn))
    type = 'service';
  else if (/@InjectRepository|Repository/i.test(annotations.join('')) || /repositor|dao/i.test(bn))
    type = 'dao';
  else if (/processor|consumer|worker|job|batch/i.test(bn) || /batch|jobs?/i.test(fp))
    type = 'batch';

  return { pkg: '', className, annotations: [...new Set(annotations)], routes, imports, injected, type };
}

// ── project.env 파서 ─────────────────────────────────────────────────────────

function parseProjectEnv() {
  const p = path.join(WORKSPACE, 'project.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs.readFileSync(p, 'utf-8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function main() {
  const env = parseProjectEnv();
  const count = parseInt(env.SOURCE_COUNT || '1', 10);

  // 소스 경로 수집
  const sourcePaths = [];
  for (let i = 1; i <= count; i++) {
    const p = env[`SOURCE_${i}_PATH`];
    const label = env[`SOURCE_${i}_LABEL`] || `src${i}`;
    if (p && fs.existsSync(p)) {
      sourcePaths.push({ path: path.resolve(p), label });
    }
  }
  if (!sourcePaths.length) sourcePaths.push({ path: WORKSPACE, label: 'src' });

  console.log('[scan_source] 스캔 시작');
  sourcePaths.forEach(s => console.log(`  소스: [${s.label}] ${s.path}`));

  const allFiles = [];
  const langStats = {};

  for (const src of sourcePaths) {
    const files = collectFiles(src.path);
    for (const { fullPath, ext } of files) {
      const lang = LANG_BY_EXT[ext];
      langStats[lang] = (langStats[lang] || 0) + 1;

      let content = '';
      try { content = fs.readFileSync(fullPath, 'utf-8'); }
      catch (_) { continue; }

      // 너무 큰 파일 스킵 (1MB)
      if (content.length > 1_000_000) continue;

      const relPath = path.relative(src.path, fullPath).replace(/\\/g, '/');

      let parsed;
      if (lang === 'java' || lang === 'kotlin') {
        parsed = parseJava(content, fullPath);
      } else if (lang === 'python') {
        parsed = parsePython(content, fullPath);
      } else if (lang === 'typescript' || lang === 'javascript') {
        parsed = parseTypeScript(content, fullPath);
      } else {
        // Go, C#, Ruby, PHP — 파일명 기반 type 추정만
        const bn = path.basename(fullPath, ext).toLowerCase();
        const type =
          /controller|handler|route|api/i.test(bn) ? 'controller' :
          /service/i.test(bn) ? 'service' :
          /repositor|dao|mapper/i.test(bn) ? 'dao' :
          /batch|job|worker/i.test(bn) ? 'batch' : 'other';
        parsed = { pkg: '', className: '', annotations: [], routes: [], imports: [], injected: [], type };
      }

      allFiles.push({
        filePath: fullPath.replace(/\\/g, '/'),
        relPath,
        sourceLabel: src.label,
        lang,
        package: parsed.pkg,
        className: parsed.className,
        type: parsed.type,
        annotations: parsed.annotations,
        routes: parsed.routes,
        imports: parsed.imports,
        injected: parsed.injected,
      });
    }
  }

  // type별 요약
  const typeStats = {};
  for (const f of allFiles) typeStats[f.type] = (typeStats[f.type] || 0) + 1;

  const output = {
    scannedAt: new Date().toISOString(),
    workspace: WORKSPACE,
    langStats,
    typeStats,
    files: allFiles,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

  console.log('\n[scan_source] 완료');
  console.log('  언어별:', Object.entries(langStats).map(([k,v]) => `${k}:${v}`).join(' '));
  console.log('  타입별:', Object.entries(typeStats).map(([k,v]) => `${k}:${v}`).join(' '));
  console.log(`  → ${OUT_PATH}`);

  // 컨트롤러/배치 목록 미리보기
  const controllers = allFiles.filter(f => f.type === 'controller');
  const batches     = allFiles.filter(f => f.type === 'batch');
  if (controllers.length) {
    console.log(`\n  컨트롤러 ${controllers.length}개:`);
    controllers.slice(0, 5).forEach(f => console.log(`    ${f.relPath} (라우트 ${f.routes.length}개)`));
    if (controllers.length > 5) console.log(`    ... 외 ${controllers.length - 5}개`);
  }
  if (batches.length) {
    console.log(`\n  배치 ${batches.length}개:`);
    batches.slice(0, 3).forEach(f => console.log(`    ${f.relPath}`));
  }
}

main();
