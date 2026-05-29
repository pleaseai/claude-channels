# Claude Code용 GitHub 채널

**GitHub 이슈/PR @멘션 댓글**을 실행 중인 Claude Code 세션으로 연결하고, Claude가 댓글로 답글·반응·수정을 할 수 있게 해주는 양방향 [채널](https://code.claude.com/docs/en/channels) 플러그인입니다.

로컬 서브프로세스는 GitHub 웹훅을 수신할 수 없으므로, 이 채널은 GitHub REST API를 **폴링**합니다 (Telegram/Discord 채널과 동일한 방식). 공개 URL 없이 로컬에서 동작합니다.

## 동작 방식

- **인바운드** — 감시 중인 저장소에서 설정된 핸들을 `@멘션`한 이슈/PR 댓글을 폴링하여 `<channel source="github">` 이벤트로 전달합니다.
- **아웃바운드** — Claude가 `reply` / `react` / `edit_message` / `fetch_messages` 도구로 해당 스레드에 작업합니다.
- **발신자 게이팅** — allowlist에 등록된 GitHub 로그인의 댓글만 전달됩니다 (저장소가 아닌 댓글 작성자 기준).

## 설정

### 1. Personal Access Token 생성

감시할 저장소에 대해 [fine-grained PAT](https://github.com/settings/tokens?type=beta)를 생성하고 다음 권한을 부여하세요:

- Repository → **Issues**: Read and write
- Repository → **Pull requests**: Read and write
- Repository → **Metadata**: Read

### 2. 자격 증명 구성

```
/github:configure <token> owner/repo,owner/repo2
```

`~/.claude/channels/github/.env` (권한 `0600`)에 저장됩니다:

```
CLAUDE_GITHUB_TOKEN=github_pat_...
CLAUDE_GITHUB_REPOS=owner/repo,owner/repo2
```

선택 설정:

- `CLAUDE_GITHUB_MENTION=<handle>` — 매칭할 핸들 (기본값: 토큰 계정의 로그인)
- `CLAUDE_GITHUB_POLL_INTERVAL_MS=5000` — 폴링 주기

### 3. 발신자 허용

```
/github:access allow <github-login>
```

`/github:access policy open`으로 모든 작성자를 허용하거나, `list`로 상태를 확인할 수 있습니다.

### 4. 채널을 활성화하여 실행

채널 리서치 프리뷰 기간에는 커스텀 채널에 개발 플래그가 필요합니다:

```bash
claude --dangerously-load-development-channels plugin:github@<marketplace>
```

이후 감시 중인 이슈/PR 댓글에서 핸들을 `@멘션`하면 댓글이 세션에 도착하고 Claude가 댓글로 답글합니다.

## 도구

| 도구             | 용도                                         |
| ---------------- | -------------------------------------------- |
| `reply`          | `owner/repo#number`에 댓글 작성              |
| `react`          | 댓글에 반응 추가 (`+1`, `eyes`, `rocket` 등) |
| `edit_message`   | 이 세션에서 작성한 댓글 수정                 |
| `fetch_messages` | 스레드의 최근 댓글 조회                      |

## 상태

`~/.claude/channels/github/`

- `.env` — 자격 증명 (`0600`)
- `access.json` — 발신자 allowlist + 정책
- `cursor.json` — 폴링 커서 (재시작 시 이전 댓글 재전송 방지)

## 개발

```bash
bun install
bun test plugins/github/   # 단위 + MCP stdio 통합 테스트
bun run lint
```

## 작성자

이민수 ([@amondnet](https://github.com/amondnet))
