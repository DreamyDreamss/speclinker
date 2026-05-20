"""
resolve_call_chain.py
컨트롤러 파일 경로를 받아 연관된 서비스·DAO·쿼리 파일 경로를 반환한다.
router_inventory.json의 각 항목에 relatedFiles를 주입하기 위해 sl-recon STEP 4에서 호출한다.

사용법:
  python3 resolve_call_chain.py <router_inventory.json> <workspace_root>

출력:
  router_inventory_with_chain.json — relatedFiles 필드가 추가된 인벤토리
"""

import sys
import os
import re
import json

# 따라갈 레이어 키워드 (패키지/디렉토리 이름 기준)
FOLLOW_LAYERS = ('service', 'dao', 'repository', 'mapper', 'store', 'repo', 'persistence')
# 건너뛸 레이어 (인프라·공통 코드)
SKIP_LAYERS   = ('util', 'common', 'constant', 'exception', 'annotation', 'config',
                 'enum', 'dto', 'vo', 'msg', 'helper', 'interceptor', 'filter',
                 'security', 'auth', 'jwt', 'swagger', 'model', 'entity', 'domain')

# 쿼리 파일 확장자 (데이터 접근 계층 파일)
QUERY_EXTS = ('.xml', '.sql', '.graphql', '.prisma')
QUERY_DIR_KW = ('mapper', 'sql', 'query', 'mybatis', 'resources')


def norm(p):
    return p.replace('\\', '/') if p else ''


# ──────────────────────────────────────────────
# 언어별 import 파싱
# ──────────────────────────────────────────────

def extract_java_imports(content, source_root):
    """Java import 문에서 연관 파일 경로 목록 반환"""
    files = []
    for m in re.finditer(r'^import\s+([\w.]+);', content, re.M):
        fqn = m.group(1)
        parts = fqn.split('.')
        # 외부 라이브러리 제외 (org.*, java.*, lombok.* 등)
        # 프로젝트 내부 패키지 판별: source_root 하위에 파일이 실제 존재하는지 확인
        class_name = parts[-1]
        pkg_path   = os.path.join(*parts[:-1]) if len(parts) > 1 else ''

        # 레이어 필터: FOLLOW_LAYERS에 속하고 SKIP_LAYERS에 없으면 따라감
        pkg_lower = pkg_path.lower().replace('\\', '/')
        if not any(k in pkg_lower for k in FOLLOW_LAYERS):
            continue
        if any(k in pkg_lower for k in SKIP_LAYERS):
            continue

        # source_root 하위 전체에서 {ClassName}.java 검색
        for root, dirs, fnames in os.walk(source_root):
            # node_modules, .git 등 건너뜀
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
            for fname in fnames:
                if fname == class_name + '.java':
                    candidate = os.path.join(root, fname)
                    files.append(norm(candidate))
    return files


def extract_python_imports(content, file_path, workspace_root):
    """Python import/from 문에서 연관 파일 경로 반환"""
    files = []
    base_dir = os.path.dirname(file_path)

    # from .xxx import / from ..xxx.yyy import 형태
    for m in re.finditer(r'^(?:from|import)\s+(\.+[\w.]*|[\w.]+)\s*(?:import\s+\w+)?', content, re.M):
        module = m.group(1)
        # 상대 경로
        if module.startswith('.'):
            dots = len(module) - len(module.lstrip('.'))
            rel   = module.lstrip('.')
            parts = rel.split('.') if rel else []
            base  = base_dir
            for _ in range(dots - 1):
                base = os.path.dirname(base)
            candidate_dir = os.path.join(base, *parts)
            for ext in ('.py',):
                for suffix in ('', '__init__'):
                    p = os.path.join(candidate_dir, suffix + ext) if suffix else candidate_dir + ext
                    if os.path.exists(p):
                        mod_lower = norm(p).lower()
                        if any(k in mod_lower for k in FOLLOW_LAYERS):
                            files.append(norm(p))
        else:
            # 절대 경로 — workspace_root 하위에서 검색
            rel_path = module.replace('.', os.sep) + '.py'
            candidate = os.path.join(workspace_root, rel_path)
            if os.path.exists(candidate):
                mod_lower = norm(candidate).lower()
                if any(k in mod_lower for k in FOLLOW_LAYERS):
                    files.append(norm(candidate))
    return files


def extract_ts_imports(content, file_path, workspace_root):
    """TypeScript/JavaScript import 문에서 연관 파일 경로 반환"""
    files = []
    base_dir = os.path.dirname(file_path)

    for m in re.finditer(r'''(?:import|require)\s*(?:\{[^}]*\}|[\w*]+)?\s*(?:from\s*)?['"]([^'"]+)['"]''', content):
        module = m.group(1)
        if not (module.startswith('.') or module.startswith('/')):
            continue  # 외부 패키지 건너뜀

        candidate_base = os.path.normpath(os.path.join(base_dir, module))
        for ext in ('.ts', '.tsx', '.js', '.jsx', ''):
            p = candidate_base + ext if ext else candidate_base
            if os.path.isfile(p):
                mod_lower = norm(p).lower()
                if any(k in mod_lower for k in FOLLOW_LAYERS) and not any(k in mod_lower for k in SKIP_LAYERS):
                    files.append(norm(p))
                break
            # index 파일
            idx = os.path.join(candidate_base, 'index' + ext) if ext else None
            if idx and os.path.isfile(idx):
                mod_lower = norm(idx).lower()
                if any(k in mod_lower for k in FOLLOW_LAYERS) and not any(k in mod_lower for k in SKIP_LAYERS):
                    files.append(norm(idx))
                break
    return files


def detect_language(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    return {'.java': 'java', '.py': 'python',
            '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js'}.get(ext, 'unknown')


def extract_imports(file_path, workspace_root):
    """파일에서 연관 서비스/DAO 파일 목록 반환 (언어 자동 감지)"""
    if not os.path.exists(file_path):
        return []
    try:
        content = open(file_path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return []

    lang = detect_language(file_path)
    if lang == 'java':
        # source_root = 프로젝트 루트 (workspace_root 또는 상위 디렉토리)
        return extract_java_imports(content, workspace_root)
    elif lang == 'python':
        return extract_python_imports(content, file_path, workspace_root)
    elif lang in ('ts', 'js'):
        return extract_ts_imports(content, file_path, workspace_root)
    return []


def find_query_files(dao_file, workspace_root):
    """DAO 파일명 기반으로 연관 쿼리/매퍼 파일 검색"""
    base_name = os.path.splitext(os.path.basename(dao_file))[0]
    # 'CoupangMapper' → 'CoupangMapper.xml' 등 검색
    results = []
    for root, dirs, fnames in os.walk(workspace_root):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
        root_lower = norm(root).lower()
        if not any(k in root_lower for k in QUERY_DIR_KW):
            continue
        for fname in fnames:
            if os.path.splitext(fname)[1].lower() in QUERY_EXTS:
                # 파일명 일치 (확장자 제외)
                if os.path.splitext(fname)[0].lower() == base_name.lower():
                    results.append(norm(os.path.join(root, fname)))
    return results


# ──────────────────────────────────────────────
# SQL/XML 스키마 추출 (응답 컬럼·nullable 사전 파싱)
# ──────────────────────────────────────────────

SELECT_PATTERN = re.compile(
    r'SELECT\s+(.+?)\s+FROM\s+', re.I | re.S
)
LEFT_JOIN_PATTERN = re.compile(r'LEFT\s+(?:OUTER\s+)?JOIN\s+(\w+)', re.I)
MYBATIS_SELECT_PATTERN = re.compile(
    r'<select\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>(.+?)</select>', re.I | re.S
)
RESULTMAP_PATTERN = re.compile(
    r'<resultMap\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>(.+?)</resultMap>', re.I | re.S
)
RESULT_COL_PATTERN = re.compile(
    r'<(?:result|id)\s+([^/]+?)/?>', re.I
)
ATTR_PATTERN = re.compile(r'(\w+)\s*=\s*"([^"]*)"')


def parse_select_columns(select_body):
    """SELECT 절 컬럼 텍스트를 파싱해서 컬럼 리스트 반환"""
    # 'a.col1 AS alias1, b.col2, NVL(x,0) AS y' 같은 패턴
    # MyBatis 동적 SQL <if> 등은 단순 제거
    body = re.sub(r'<if[^>]*>.*?</if>', '', select_body, flags=re.S | re.I)
    body = re.sub(r'<\w+[^>]*>', '', body)
    body = re.sub(r'</\w+>', '', body)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'--[^\n]*', '', body)

    cols = []
    depth = 0
    cur = ''
    for ch in body:
        if ch == '(':
            depth += 1
            cur += ch
        elif ch == ')':
            depth -= 1
            cur += ch
        elif ch == ',' and depth == 0:
            if cur.strip():
                cols.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        cols.append(cur.strip())

    parsed = []
    for c in cols:
        # ' a.col1 AS alias1' → name=alias1, source=a.col1
        m = re.search(r'^(.+?)\s+(?:AS\s+)?(\w+)\s*$', c, re.I)
        if m:
            name = m.group(2)
            source = m.group(1).strip()
        else:
            name = c.split('.')[-1].strip()
            source = c
        # nullable 휴리스틱: CASE WHEN ... ELSE NULL, NVL, COALESCE, LEFT JOIN
        nullable = bool(
            re.search(r'ELSE\s+NULL', source, re.I)
            or re.search(r'\b(NVL|COALESCE|IFNULL)\s*\(', source, re.I)
        )
        parsed.append({'name': name, 'source': source, 'nullable': nullable})
    return parsed


def extract_query_schema(query_file):
    """SQL/XML 파일에서 SELECT 컬럼·nullable·LEFT JOIN 정보 추출"""
    if not os.path.exists(query_file):
        return None
    try:
        body = open(query_file, encoding='utf-8', errors='ignore').read()
    except Exception:
        return None

    ext = os.path.splitext(query_file)[1].lower()
    schema = {'queryFile': norm(query_file), 'selects': []}

    if ext == '.xml':
        # MyBatis: <select id="..."> ... </select>
        for m in MYBATIS_SELECT_PATTERN.finditer(body):
            stmt_id = m.group(1)
            stmt_body = m.group(2)
            sel_m = SELECT_PATTERN.search(stmt_body)
            if not sel_m:
                continue
            cols = parse_select_columns(sel_m.group(1))
            left_joins = LEFT_JOIN_PATTERN.findall(stmt_body)
            schema['selects'].append({
                'id': stmt_id,
                'columns': cols,
                'leftJoinedTables': sorted(set(t.lower() for t in left_joins)),
            })
        # resultMap도 보강
        result_maps = []
        for m in RESULTMAP_PATTERN.finditer(body):
            map_id = m.group(1)
            cols = []
            for col_m in RESULT_COL_PATTERN.finditer(m.group(2)):
                attrs = dict(ATTR_PATTERN.findall(col_m.group(1)))
                if 'property' in attrs:
                    cols.append({
                        'name':     attrs.get('property'),
                        'column':   attrs.get('column', ''),
                        'jdbcType': attrs.get('jdbcType', ''),
                    })
            result_maps.append({'id': map_id, 'columns': cols})
        if result_maps:
            schema['resultMaps'] = result_maps
    elif ext == '.sql':
        # 일반 SQL: 첫 SELECT 구문만 파싱
        sel_m = SELECT_PATTERN.search(body)
        if sel_m:
            cols = parse_select_columns(sel_m.group(1))
            left_joins = LEFT_JOIN_PATTERN.findall(body)
            schema['selects'].append({
                'id': os.path.basename(query_file),
                'columns': cols,
                'leftJoinedTables': sorted(set(t.lower() for t in left_joins)),
            })

    return schema if schema['selects'] or schema.get('resultMaps') else None


# ──────────────────────────────────────────────
# call chain 해결 (Controller → Service → DAO → Query)
# ──────────────────────────────────────────────

def resolve_chain(controller_path, workspace_root, max_depth=2):
    """
    컨트롤러 → 서비스 → DAO (최대 2홉) + 쿼리 파일까지 반환
    반환: { "service": [...], "dao": [...], "query": [...] }
    """
    visited = set()
    service_files = []
    dao_files = []
    query_files = []

    def traverse(file_path, depth):
        if depth == 0 or norm(file_path) in visited:
            return
        visited.add(norm(file_path))

        related = extract_imports(file_path, workspace_root)
        for rf in related:
            if norm(rf) in visited:
                continue
            rf_lower = norm(rf).lower()

            is_dao = any(k in rf_lower for k in ('dao', 'repository', 'mapper', 'repo', 'persistence', 'store'))
            is_svc = any(k in rf_lower for k in ('service',))

            if depth == max_depth:  # 컨트롤러 레벨 → 서비스
                service_files.append(rf)
                traverse(rf, depth - 1)
            else:  # 서비스 레벨 → DAO
                dao_files.append(rf)
                # 쿼리 파일 탐색
                qf = find_query_files(rf, workspace_root)
                query_files.extend(qf)

    traverse(controller_path, max_depth)

    services = list(dict.fromkeys(service_files))
    daos = list(dict.fromkeys(dao_files))
    queries = list(dict.fromkeys(query_files))

    # 쿼리 파일별 스키마 사전 추출 (응답 컬럼·nullable·LEFT JOIN)
    query_schemas = []
    for qf in queries:
        sch = extract_query_schema(qf)
        if sch:
            query_schemas.append(sch)

    return {
        'service':       services,
        'dao':           daos,
        'query':         queries,
        'querySchemas':  query_schemas,
    }


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print('사용법: python3 resolve_call_chain.py <inventory.json> <workspace_root>')
        print('  inventory.json: router_inventory.json 또는 batch_inventory.json')
        sys.exit(1)

    inventory_path = sys.argv[1]
    workspace_root = sys.argv[2]

    inventory = json.load(open(inventory_path, encoding='utf-8'))
    # inventory는 배치 그룹 배열 (list of list)

    total_files = 0
    total_schemas = 0
    enriched = []
    for group in inventory:
        new_group = []
        for item in group:
            fp = item.get('filePath', '')
            abs_fp = fp if os.path.isabs(fp) else os.path.join(workspace_root, fp)

            chain = resolve_chain(abs_fp, workspace_root)
            item['relatedFiles'] = chain

            n = len(chain['service']) + len(chain['dao']) + len(chain['query'])
            ns = len(chain.get('querySchemas', []))
            total_files += n
            total_schemas += ns
            if n:
                print(f"  {os.path.basename(fp)}: svc={len(chain['service'])} dao={len(chain['dao'])} query={len(chain['query'])} schema={ns}")

            new_group.append(item)
        enriched.append(new_group)

    # 출력 파일명: 입력 파일명 기반 자동 결정
    base_name = os.path.splitext(os.path.basename(inventory_path))[0]
    out_filename = f'{base_name}_with_chain.json'
    out_path = os.path.join(os.path.dirname(inventory_path), out_filename)
    json.dump(enriched, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'\n{out_filename} 저장 완료 (연관 파일 {total_files}개, 스키마 사전 추출 {total_schemas}개)')


if __name__ == '__main__':
    main()
