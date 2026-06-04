# mcp-atlassian 제공 도구 목록

`.mcp.json`에 `atlassian` 항목을 설정하면 아래 도구들이 Claude에서 자동 활성화됩니다.  
(`uvx mcp-atlassian` 기준 — 온프레미스/클라우드 모두 동일)

---

## Jira 도구

| 도구명 | 기능 |
|--------|------|
| `jira_get_issue` | 이슈 키로 상세 조회 (요약·설명·상태·담당자·댓글) |
| `jira_search` | JQL로 이슈 목록 검색 |
| `jira_get_project_issues` | 프로젝트의 이슈 전체 조회 |
| `jira_create_issue` | 새 이슈 생성 |
| `jira_update_issue` | 이슈 필드 수정 (요약·설명·상태 등) |
| `jira_add_comment` | 이슈에 댓글 추가 |
| `jira_get_transitions` | 이슈 상태 전환 목록 조회 |
| `jira_transition_issue` | 이슈 상태 전환 (예: In Progress → Done) |
| `jira_get_projects` | 프로젝트 목록 조회 |
| `jira_get_components` | 프로젝트 컴포넌트 목록 |
| `jira_get_sprints` | 보드의 스프린트 목록 |
| `jira_get_board_issues` | 보드 이슈 목록 |

## Confluence 도구

| 도구명 | 기능 |
|--------|------|
| `confluence_get_page` | 페이지 ID 또는 제목으로 페이지 내용 조회 |
| `confluence_search` | CQL로 페이지/블로그 검색 |
| `confluence_get_space` | 스페이스 정보 조회 |
| `confluence_get_spaces` | 스페이스 목록 조회 |
| `confluence_create_page` | 새 페이지 생성 (마크다운 → Storage 포맷 변환) |
| `confluence_update_page` | 기존 페이지 내용 업데이트 |
| `confluence_get_page_children` | 하위 페이지 목록 조회 |
| `confluence_get_comments` | 페이지 댓글 목록 |
| `confluence_add_comment` | 페이지에 댓글 추가 |

---

## speclinker 에이전트별 활용 패턴

| 에이전트 | 활용 도구 | 용도 |
|--------|---------|------|
| `rd-agent` | `jira_search`, `jira_get_issue` | SR 이슈에서 변경 요구 추출 |
| `srs-agent` | `jira_get_issue`, `confluence_get_page` | AS-IS 스펙 문서 참조 |
| `rtm-agent` | `jira_update_issue`, `jira_add_comment` | RTM 결과를 지라 이슈에 반영 |
| `dev-agent` | `jira_transition_issue`, `jira_add_comment` | 개발 완료 상태 전환 |
| `test-agent` | `jira_get_issue`, `jira_add_comment` | TC 결과 이슈 코멘트 기록 |
| `spec-agent` | `confluence_create_page` | 산출물 완성 후 위키 페이지 업로드 |

---

## 설치 (최초 1회)

```bash
pip install uv
uvx mcp-atlassian --help   # 설치 확인
```

## 온프레미스 인증 방식

| 서버 종류 | JIRA_API_TOKEN 값 |
|---------|------------------|
| Jira Data Center | PAT (Personal Access Token) |
| Jira Server (구버전) | 사용자 비밀번호 |

PAT 발급: Jira 우측상단 프로필 → **Personal Access Tokens**
