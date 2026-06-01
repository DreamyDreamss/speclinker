#!/usr/bin/env node
/**
 * scan_source.js — AST 기반 소스 스캐너 (Tree-sitter 우선, regex fallback)
 *
 * annotation/decorator 기반 정적 분석으로 컨트롤러·서비스·DAO·배치 파일을 탐지하고
 * 라우트를 추출한다.
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

// ── Tree-sitter 선택적 로드 (미설치 시 regex fallback) ──────────────────────
let TsParser, JavaGrammar, PythonGrammar, TsTypescriptGrammar;
try {
  TsParser = require('tree-sitter');
  try { JavaGrammar       = require('tree-sitter-java');                      } catch(_) {}
  try { PythonGrammar     = require('tree-sitter-python');                    } catch(_) {}
  try { TsTypescriptGrammar = require('tree-sitter-typescript').typescript;   } catch(_) {}
} catch(_) {}

const TS_JAVA_OK = !!(TsParser && JavaGrammar);
const TS_PY_OK   = !!(TsParser && PythonGrammar);
const TS_TS_OK   = !!(TsParser && TsTypescriptGrammar);

// 파서 인스턴스 재사용 (파일마다 new Parser() 생성 금지 — 성능 핵심)
let _javaParser, _pyParser, _tsParser;
function getJavaParser()  { if (!_javaParser)  { _javaParser  = new TsParser(); _javaParser.setLanguage(JavaGrammar);          } return _javaParser;  }
function getPyParser()    { if (!_pyParser)    { _pyParser    = new TsParser(); _pyParser.setLanguage(PythonGrammar);           } return _pyParser;    }
function getTsParser()    { if (!_tsParser)    { _tsParser    = new TsParser(); _tsParser.setLanguage(TsTypescriptGrammar);     } return _tsParser;    }

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
 * 문자열 리터럴·주석 내부 중괄호를 올바르게 스킵한다 (regex fallback용).
 */
function extractMethodBody(content, annotIndex) {
  let i = annotIndex;
  let parenDepth = 0;

  // 어노테이션·메서드 시그니처를 지나 첫 '{' 탐지 (문자열 스킵)
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < content.length && content[i] !== q) { if (content[i] === '\\') i++; i++; }
    } else if (ch === '(') { parenDepth++; }
    else if (ch === ')') { parenDepth--; }
    else if (ch === '{' && parenDepth === 0) { break; }
    else if (ch === ';' && parenDepth === 0) { return ''; } // abstract/interface
    i++;
  }
  if (i >= content.length) return '';

  // 중괄호 depth 카운팅 (문자열·주석 스킵)
  let depth = 0;
  const start = i;
  for (let j = i; j < content.length; j++) {
    const ch = content[j];
    if (ch === '"' || ch === "'") {
      const q = ch; j++;
      while (j < content.length && content[j] !== q) { if (content[j] === '\\') j++; j++; }
    } else if (ch === '/' && content[j + 1] === '/') {
      while (j < content.length && content[j] !== '\n') j++;
    } else if (ch === '/' && content[j + 1] === '*') {
      j += 2;
      while (j < content.length && !(content[j] === '*' && content[j + 1] === '/')) j++;
      j++;
    } else if (ch === '{') { depth++; }
    else if (ch === '}') { depth--; if (depth === 0) return content.slice(start, j + 1); }
  }
  return '';
}

// jwork + Spring 범용 JSON 응답 시그널 — 메서드 바디 안에서 이 중 하나라도 있으면 api
// ※ @ResponseBody는 바디 외부(선언부)에 있으므로 별도 탐지
const API_BODY_SIGNALS = /GridResultUtil|AjaxMessageMapRenderer|ResponseEntity/;
const METHOD_RESPONSE_BODY = /@ResponseBody/;

// ── Tree-sitter Java AST 헬퍼 ─────────────────────────────────────────────────

/** annotation / marker_annotation 노드에서 이름 추출 */
function tsAnnotName(node) {
  for (const ch of node.children) {
    if (ch.type === 'identifier') return ch.text;
  }
  return '';
}

/**
 * annotation 노드에서 경로 문자열 목록 반환.
 * @RequestMapping("/p"), @RequestMapping(value="/p"),
 * @RequestMapping({"/a","/b"}), @RequestMapping("relPath") 모두 처리.
 *
 * 포함: '/' 시작(절대경로) OR '/' 없는 상대 경로 세그먼트 (예: "st001mForm")
 * 제외: "application/json" 같은 미디어 타입 (슬래시 포함하되 앞에 없음)
 */
function tsAnnotPaths(node) {
  const result = [];
  for (const s of node.descendantsOfType('string_literal')) {
    const val = s.text.replace(/^["'`]|["'`]$/g, '');
    if (!val) continue;
    const isAbsPath    = val.startsWith('/');
    const isRelSegment = !val.includes('/') && !val.includes('=') && !val.includes(';');
    if (isAbsPath || isRelSegment) result.push(val);
  }
  return result;
}

/**
 * Tree-sitter Java AST 기반 파서.
 * 성공 시 parseJava와 동일한 구조 반환, 실패 시 null (regex fallback 유도).
 */
function parseJavaAST(content, filePath) {
  try {
    const parser = getJavaParser();
    const tree   = parser.parse(content);
    const root   = tree.rootNode;

    let pkg = '', className = '';
    const imports   = [];
    const injected  = [];
    const annotations = [];
    const routes    = [];

    // package
    const pkgDecl = root.descendantsOfType('package_declaration')[0];
    if (pkgDecl) {
      pkg = pkgDecl.text.replace(/^package\s+/, '').replace(/\s*;\s*$/, '');
    }

    // imports
    for (const n of root.descendantsOfType('import_declaration')) {
      imports.push(n.text.replace(/^import\s+(static\s+)?/, '').replace(/\s*;\s*$/, ''));
    }

    // top-level class (첫 번째)
    const classDecl = root.descendantsOfType('class_declaration')[0];
    if (!classDecl) return null;

    // class name
    const classIdent = classDecl.children.find(n => n.type === 'identifier');
    if (classIdent) className = classIdent.text;

    // class-level annotations
    let baseMapping = '';
    let isAllApi    = false;
    const classMods = classDecl.children.find(n => n.type === 'modifiers');
    if (classMods) {
      for (const ch of classMods.children) {
        if (ch.type !== 'annotation' && ch.type !== 'marker_annotation') continue;
        const name = tsAnnotName(ch);
        if (!name) continue;
        annotations.push('@' + name);
        if (name === 'RestController' || name === 'ResponseBody') isAllApi = true;
        if (name === 'RequestMapping') {
          const paths = tsAnnotPaths(ch);
          if (paths.length) baseMapping = paths[0].replace(/\/\*$/, '');
        }
      }
    }

    // method declarations (direct children of class body)
    const classBody = classDecl.children.find(n => n.type === 'class_body');
    if (classBody) {
      for (const member of classBody.children) {
        // field injection
        if (member.type === 'field_declaration') {
          const fMods = member.children.find(n => n.type === 'modifiers');
          if (fMods && fMods.children.some(m =>
            (m.type === 'annotation' || m.type === 'marker_annotation') && tsAnnotName(m) === 'Autowired'
          )) {
            // type is the node after modifiers
            const typeNode = member.children.find(n => n !== fMods && n.type.endsWith('type'));
            if (typeNode) injected.push(typeNode.text.replace(/<[^>]*>/g, '').trim());
          }
          continue;
        }

        if (member.type !== 'method_declaration') continue;

        const mMods = member.children.find(n => n.type === 'modifiers');
        if (!mMods) continue;
        const methodName = member.children.find(n => n.type === 'identifier')?.text || '';

        for (const mod of mMods.children) {
          if (mod.type !== 'annotation' && mod.type !== 'marker_annotation') continue;
          const aName = tsAnnotName(mod);
          const verbMatch = aName.match(/^(Get|Post|Put|Delete|Patch|Request)Mapping$/);
          if (!verbMatch) continue;

          const verbMap = { Get:'GET', Post:'POST', Put:'PUT', Delete:'DELETE', Patch:'PATCH', Request:'ANY' };
          const verb = verbMap[verbMatch[1]];
          const subPaths = tsAnnotPaths(mod);
          if (subPaths.length === 0) subPaths.push('');

          let kind = 'api';
          if (!isAllApi) {
            const hasRespBody = mMods.children.some(m =>
              (m.type === 'annotation' || m.type === 'marker_annotation') && tsAnnotName(m) === 'ResponseBody'
            );
            if (hasRespBody) {
              kind = 'api';
            } else {
              const bodyNode = member.children.find(n => n.type === 'block');
              const bodyText = bodyNode ? bodyNode.text : '';
              kind = API_BODY_SIGNALS.test(bodyText) ? 'api' : 'form';
            }
          }

          for (const sp of subPaths) {
            const fullPath = (baseMapping + '/' + sp).replace(/\/+/g, '/') || '/';
            routes.push({ method: verb, path: fullPath, handlerMethod: methodName, kind });
          }
        }
      }
    }

    // constructor injection: first constructor params
    const ctorDecl = classBody?.children.find(n => n.type === 'constructor_declaration');
    if (ctorDecl) {
      const params = ctorDecl.descendantsOfType('formal_parameter');
      for (const p of params) {
        const typeNode = p.children.find(n => n.type.endsWith('type'));
        if (typeNode) {
          const typeName = typeNode.text.replace(/<[^>]*>/g, '').trim();
          if (typeName && !injected.includes(typeName)) injected.push(typeName);
        }
      }
    }

    // type determination (same logic as regex parser)
    const fp  = filePath.replace(/\\/g, '/').toLowerCase();
    const bn  = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const hasA = (arr) => annotations.some(a => arr.some(x => a.toLowerCase().startsWith(x.toLowerCase())));

    let type = 'other';
    if      (hasA(JAVA_DAO_ANNOTS)  || /dao|mapper|repository/i.test(className)) type = 'dao';
    else if (hasA(JAVA_SVC_ANNOTS)  || /service/i.test(className))                type = 'service';
    else if (hasA(JAVA_CTRL_ANNOTS))                                               type = 'controller';
    else if (JAVA_BATCH_NAMES.test(bn) || JAVA_BATCH_DIRS.test(fp))               type = 'batch';

    return { pkg, className, annotations: [...new Set(annotations)], routes, imports, injected, type };
  } catch (_) {
    return null; // tree-sitter 파싱 실패 → regex fallback
  }
}

const JAVA_CTRL_ANNOTS = [
  '@RestController', '@Controller', '@RequestMapping',
  '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping',
];
const JAVA_SVC_ANNOTS  = ['@Service', '@Component', '@EventListener'];
const JAVA_DAO_ANNOTS  = ['@Repository', '@Mapper', '@Dao'];
const JAVA_BATCH_NAMES = /batch|job|scheduler|task|worker|consumer|processor|jobbean|step/i;
const JAVA_BATCH_DIRS  = /batch|job|jobs|scheduler|schedule/i;

// 컨트롤러 후보 빠른 판별 — @Controller / @RestController 있으면 AST 파싱 가치 있음
const CTRL_QUICK_RE = /@(?:Rest)?Controller\b/;

/** Java 파서 진입점 — 컨트롤러 후보만 tree-sitter, 나머지는 regex (성능 최적화) */
function parseJava(content, filePath) {
  if (TS_JAVA_OK && CTRL_QUICK_RE.test(content)) {
    const result = parseJavaAST(content, filePath);
    if (result) return result;
  }
  return parseJavaRegex(content, filePath);
}

function parseJavaRegex(content, filePath) {
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
  // 끝의 /* 는 Spring MVC DispatcherServlet 와일드카드 — 실제 URL 세그먼트가 아니므로 제거
  let baseMapping = '';
  const baseMM = preClass.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
  if (baseMM) baseMapping = baseMM[1].replace(/\/\*$/, '');

  // @RestController 또는 클래스 수준 @ResponseBody이면 전체 api
  const isRestController     = annotations.some(a => /^@RestController(\(|$)/.test(a));
  const isClassResponseBody  = annotations.some(a => /^@ResponseBody(\(|$)/.test(a));
  const isAllApi = isRestController || isClassResponseBody;

  // method-level HTTP mappings — 클래스 선언 이후 구간만 스캔 (클래스 레벨 어노테이션 중복 방지)
  const methodContent = classPos > 0 ? content.slice(classPos) : content;
  const methodPat = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
  while ((m = methodPat.exec(methodContent)) !== null) {
    const verb     = m[1] === 'Request' ? 'ANY' : m[1].toUpperCase();
    const subPath  = m[2];
    const fullPath = (baseMapping + '/' + subPath).replace(/\/+/g, '/');
    // find method name after annotation (methodContent 기준 인덱스 사용)
    const afterAnnot = methodContent.slice(m.index, m.index + 300);
    const handlerM  = afterAnnot.match(/(?:public|private|protected)?\s+\w+\s+(\w+)\s*\(/);

    let kind = 'api';
    if (!isAllApi) {
      // @Controller (클래스 수준 @ResponseBody 없음): 메서드별 판별
      // m.index는 methodContent 기준이므로 content 절대 위치로 변환
      const absIdx = (classPos > 0 ? classPos : 0) + m.index;
      const declArea = content.slice(Math.max(0, absIdx - 300), absIdx + 50);
      const body = extractMethodBody(content, absIdx);
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

// ── 컨텍스트 경로 자동 감지 ──────────────────────────────────────────────────
//
// 탐지 우선순위:
//  1. project.env  CONTEXT_PATH (명시적 오버라이드)
//  2. web.xml      DispatcherServlet <url-pattern>   (Spring MVC)
//  3. application.properties / yml                   (Spring Boot)
//  4. main.ts      app.setGlobalPrefix(...)           (NestJS)
//  5. main.py/app.py  FastAPI(root_path=...) / include_router(prefix=...)
//  6. .env         CONTEXT_PATH / APP_PREFIX / BASE_PATH / API_PREFIX

function normalizeContextPath(cp) {
  cp = (cp || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!cp) return '';
  if (!cp.startsWith('/')) cp = '/' + cp;
  cp = cp.replace(/\/+$/, '');
  return cp === '/' ? '' : cp;
}

/** 우선순위 경로 목록으로 설정 파일 검색. 없으면 재귀 fallback(depth 5). */
function findConfigFile(root, filename) {
  const QUICK = [
    'src/main/webapp/WEB-INF',
    'src/main/resources',
    'src/main/resources/config',
    'src',
    'config',
    '.',
  ];
  for (const sub of QUICK) {
    const c = path.join(root, sub, filename);
    if (fs.existsSync(c)) return c;
  }
  // 재귀 fallback
  function walk(dir, d) {
    if (d > 5) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) if (e.name === filename && e.isFile()) return path.join(dir, e.name);
    for (const e of entries)
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) { const f = walk(path.join(dir, e.name), d + 1); if (f) return f; }
    return null;
  }
  return walk(root, 0);
}

function parseWebXmlPrefix(fpath) {
  try {
    const content = fs.readFileSync(fpath, 'utf-8');
    const blocks = content.match(/<servlet-mapping[\s\S]*?<\/servlet-mapping>/g) || [];
    for (const block of blocks) {
      // 블록 내 모든 url-pattern 수집
      const urlPat = /<url-pattern>\s*([^<]+?)\s*<\/url-pattern>/g;
      let m;
      while ((m = urlPat.exec(block)) !== null) {
        const p = m[1].trim();
        // /prefix/* 형태만 (DispatcherServlet prefix 매핑) — /* 전체 와일드카드 제외
        if (p.startsWith('/') && p.endsWith('/*') && p !== '/*') {
          const stripped = p.slice(0, -2); // /app/* → /app
          if (stripped && stripped !== '/') return stripped;
        }
      }
    }
  } catch {}
  return '';
}

function parseSpringBootContextPath(fpath) {
  try {
    const content = fs.readFileSync(fpath, 'utf-8');
    // properties: server.servlet.context-path=/app
    let m = content.match(/server\.servlet\.context-path\s*=\s*([^\s\n\r]+)/);
    if (m) return normalizeContextPath(m[1]);
    // yml: context-path: /app  (들여쓰기 불문)
    m = content.match(/context-path:\s*([^\s\n\r]+)/);
    if (m) return normalizeContextPath(m[1]);
  } catch {}
  return '';
}

function parseNestGlobalPrefix(fpath) {
  try {
    const content = fs.readFileSync(fpath, 'utf-8');
    const m = content.match(/setGlobalPrefix\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m) return normalizeContextPath(m[1]);
  } catch {}
  return '';
}

function parseFastApiPrefix(fpath) {
  try {
    const content = fs.readFileSync(fpath, 'utf-8');
    // FastAPI(root_path="/api")
    let m = content.match(/root_path\s*=\s*['"]([^'"]+)['"]/);
    if (m) return normalizeContextPath(m[1]);
    // include_router(router, prefix="/api/v1")
    m = content.match(/include_router\s*\([^)]*?prefix\s*=\s*['"]([^'"]+)['"]/);
    if (m) return normalizeContextPath(m[1]);
  } catch {}
  return '';
}

function parseDotEnvPrefix(fpath) {
  try {
    const content = fs.readFileSync(fpath, 'utf-8');
    const m = content.match(/^(?:CONTEXT_PATH|APP_PREFIX|BASE_PATH|API_PREFIX)\s*=\s*([^\n\r]+)/m);
    if (m) return normalizeContextPath(m[1]);
  } catch {}
  return '';
}

function detectContextPath(sourcePaths, env) {
  // 1. project.env 명시적 오버라이드
  if (env.CONTEXT_PATH) {
    const cp = normalizeContextPath(env.CONTEXT_PATH);
    if (cp) { console.log(`  [context-path] project.env CONTEXT_PATH="${cp}"`); return cp; }
  }

  const tried = new Set();
  const roots = [WORKSPACE, ...sourcePaths.map(s => s.path)];

  for (const root of roots) {
    // 2. web.xml (Spring MVC)
    const webXml = findConfigFile(root, 'web.xml');
    if (webXml && !tried.has(webXml)) {
      tried.add(webXml);
      const cp = parseWebXmlPrefix(webXml);
      if (cp) { console.log(`  [context-path] web.xml="${cp}" (${path.relative(WORKSPACE, webXml)})`); return cp; }
    }

    // 3. Spring Boot properties / yml
    for (const fname of ['application.properties', 'application.yml', 'application.yaml']) {
      const f = findConfigFile(root, fname);
      if (f && !tried.has(f)) {
        tried.add(f);
        const cp = parseSpringBootContextPath(f);
        if (cp) { console.log(`  [context-path] ${path.basename(f)}="${cp}"`); return cp; }
      }
    }

    // 4. NestJS main.ts
    const mainTs = findConfigFile(root, 'main.ts');
    if (mainTs && !tried.has(mainTs)) {
      tried.add(mainTs);
      const cp = parseNestGlobalPrefix(mainTs);
      if (cp) { console.log(`  [context-path] NestJS main.ts globalPrefix="${cp}"`); return cp; }
    }

    // 5. FastAPI main.py / app.py
    for (const fname of ['main.py', 'app.py']) {
      const f = findConfigFile(root, fname);
      if (f && !tried.has(f)) {
        tried.add(f);
        const cp = parseFastApiPrefix(f);
        if (cp) { console.log(`  [context-path] FastAPI ${fname} prefix="${cp}"`); return cp; }
      }
    }

    // 6. .env 계열
    for (const fname of ['.env', '.env.local', '.env.production']) {
      const f = path.join(root, fname);
      if (fs.existsSync(f) && !tried.has(f)) {
        tried.add(f);
        const cp = parseDotEnvPrefix(f);
        if (cp) { console.log(`  [context-path] ${fname}="${cp}"`); return cp; }
      }
    }
  }

  console.log('  [context-path] 미감지 (context path 없음)');
  return '';
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
  console.log(`  파서: ${TS_JAVA_OK ? 'tree-sitter(Java)' : 'regex'} / ${TS_PY_OK ? 'tree-sitter(Python)' : 'regex'} / ${TS_TS_OK ? 'tree-sitter(TS)' : 'regex'}`);
  sourcePaths.forEach(s => console.log(`  소스: [${s.label}] ${s.path}`));

  const contextPath = detectContextPath(sourcePaths, env);

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

      // context path 적용 — 감지된 경우 모든 route에 prepend
      let routes = parsed.routes;
      if (contextPath && routes.length) {
        routes = routes.map(r => ({
          ...r,
          path: r.path.startsWith(contextPath)
            ? r.path
            : contextPath + (r.path.startsWith('/') ? r.path : '/' + r.path),
        }));
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
        routes,
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
    contextPath: contextPath || null,
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
