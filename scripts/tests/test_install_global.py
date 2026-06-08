#!/usr/bin/env python3
"""install.py --global-template 명령 구성 검증 (실제 claude mcp add 미실행 — monkeypatch)."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'mcp-servers'))
import install


def test_global_template_builds_user_scope_cmd():
    calls = []
    install.shutil.which = lambda x: '/usr/bin/claude'        # claude 있다고 가정

    def fake_run(cmd):
        calls.append(cmd)
        if len(cmd) >= 3 and cmd[1:3] == ['mcp', 'get']:
            return (1, '')      # 미등록 → add 진행
        return (0, '')          # add 성공
    install.run_silent = fake_run

    install.register_global_template(['oracle'])

    add = next((c for c in calls if c[1:3] == ['mcp', 'add']), None)
    assert add, ('mcp add 명령 미생성', calls)
    assert 'db-oracle' in add and '--scope' in add and 'user' in add, add
    assert 'ORA_HOST=CHANGE_ME' in add and 'ORA_PASSWORD=CHANGE_ME' in add, ('placeholder creds 누락', add)
    assert any(str(a).endswith('oracle_schema_server.py') for a in add), ('서버 경로 누락', add)
    # creds 입력 프롬프트가 없어야(비대화형) — 별도 검증: 명령에 실제 비번 없음
    assert not any('PASSWORD=' in str(a) and 'CHANGE_ME' not in str(a) for a in add), '실 creds가 들어감(비대화형 위반)'
    print('PASS: test_global_template_builds_user_scope_cmd')


def test_skip_when_already_registered():
    calls = []
    install.shutil.which = lambda x: '/usr/bin/claude'
    install.run_silent = lambda cmd: (calls.append(cmd) or (0, ''))  # mcp get → 0(이미 등록)
    install.register_global_template(['mariadb'])
    assert not any(c[1:3] == ['mcp', 'add'] for c in calls), '이미 등록인데 add 시도함'
    print('PASS: test_skip_when_already_registered')


if __name__ == '__main__':
    test_global_template_builds_user_scope_cmd()
    test_skip_when_already_registered()
