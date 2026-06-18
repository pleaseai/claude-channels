# Claude Code용 GitHub 채널

**GitHub 이슈/PR @멘션 댓글**을 실행 중인 Claude Code 세션으로 연결하고, Claude가 댓글로 답글·반응·수정을 할 수 있게 해주는 양방향 [채널](https://code.claude.com/docs/en/channels) 플러그인입니다.

기본적으로 이 채널은 Personal Access Token으로 GitHub REST API를 **폴링**합니다 (Telegram/Discord 채널과 동일한 방식) — 공개 URL 없이 로컬에서 동작합니다. 선택적으로 **웹훅 모드**도 지원합니다: GitHub App + Cloudflare 터널로 노출되는 로컬 서명 검증 웹훅 수신기를 통해, 폴링 주기 지연 없이 실시간으로 전달합니다. 폴링이 기본값이며, [웹훅 트랜스포트](#웹훅-트랜스포트-github-app--cloudflare-터널)를 참고하세요.

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

## 웹훅 트랜스포트 (GitHub App + Cloudflare 터널)

폴링의 대안(opt-in)입니다. GitHub가 `issue_comment` 이벤트를 로컬 수신기로 실시간 푸시합니다. `CLAUDE_GITHUB_TRANSPORT=webhook`으로 활성화하며, 폴링이 기본값이라 기존 설정에는 영향이 없습니다.

**사전 요구사항**

- 호스트에 [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 설치 (채널이 서브프로세스로 실행).
- 직접 생성한 **GitHub App**: 감시 저장소에 **Issues**·**Pull requests** 읽기·쓰기 권한, **웹훅 시크릿**, **Issue comment** 이벤트 구독. 저장소에 설치한 뒤 **installation ID**를 확인합니다.

**구성** (`~/.claude/channels/github/.env`, 권한 `0600`):

```
CLAUDE_GITHUB_TRANSPORT=webhook
CLAUDE_GITHUB_APP_ID=123456
CLAUDE_GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
CLAUDE_GITHUB_APP_INSTALLATION_ID=987654
CLAUDE_GITHUB_WEBHOOK_SECRET=<random-string>
CLAUDE_GITHUB_REPOS=owner/repo,owner/repo2
```

비공개 키는 위처럼 리터럴 `\n` 이스케이프가 포함된 한 줄 또는 실제 여러 줄 PEM 모두 가능합니다.

**터널 옵션** (기본값은 무설정 quick 터널):

- `CLAUDE_GITHUB_TUNNEL_MODE=quick` (기본) — 임시 `*.trycloudflare.com` URL, Cloudflare 계정 불필요.
- `CLAUDE_GITHUB_TUNNEL_MODE=named` — 영구 터널. `CLAUDE_GITHUB_TUNNEL_NAME`, `CLAUDE_GITHUB_TUNNEL_HOSTNAME`도 설정합니다.
- `CLAUDE_GITHUB_WEBHOOK_PORT=8765` — 로컬 수신기 포트 (cloudflared가 이 포트로 전달).
- `CLAUDE_GITHUB_MENTION=<handle>` — 기본값은 App의 봇 로그인(`<app-slug>[bot]`).

시작 시 채널은 수신기를 띄우고 터널을 연 뒤 **터널 URL을 App 웹훅으로 자동 등록**합니다 (임시 quick 터널 URL도 수동 설정 없이 동작). 인바운드 페이로드는 `CLAUDE_GITHUB_WEBHOOK_SECRET`(`X-Hub-Signature-256`)로 검증되며, 폴링 모드와 동일한 발신자 allowlist·감시 저장소 게이팅·중복 제거가 적용됩니다.

> 수신기를 Cloudflare 호스팅 Worker/서비스로 배포하는 것은 향후 개선 사항이며 이 트랜스포트에 포함되지 않습니다.

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
