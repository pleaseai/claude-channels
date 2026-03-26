# claude-channel-slack

[Claude Code](https://docs.anthropic.com/en/docs/claude-code)용 Slack 채널 플러그인. Slack 워크스페이스와 Claude Code 세션을 MCP로 연결합니다 — 각 세션은 격리된 양방향 메시징을 위한 전용 스레드를 생성합니다.

## 빠른 시작

### 1. Slack 앱 생성

[api.slack.com/apps](https://api.slack.com/apps)에서 Slack 앱을 생성합니다:

- **Socket Mode** 활성화 (`xapp-` 앱 토큰 생성)
- **Bot Token Scopes**: `chat:write`, `users:read`, `reactions:write`, `files:read`, `files:write`, `app_mentions:read`
- **Bot Events**: `app_mention`
- **채널 모드**: scope `channels:history`, `channels:read` 및 이벤트 `message.channels` 추가
- **DM 모드**: scope `im:history`, `im:read`, `im:write` 및 이벤트 `message.im` 추가; **App Home > Messages Tab** 활성화

> 단계별 설정 가이드는 [Slack 설정 가이드](https://claude-channels.pleaseai.dev/getting-started/slack-setup)를 참고하세요.

### 2. 인증 정보 설정

두 가지 모드 중 하나를 선택합니다:

**채널 모드** — 공유 채널의 스레드:
```bash
mkdir -p ~/.claude/channels/slack
cat > ~/.claude/channels/slack/.env << 'EOF'
CLAUDE_SLACK_BOT_TOKEN=xoxb-봇-토큰
CLAUDE_SLACK_APP_TOKEN=xapp-앱-토큰
CLAUDE_SLACK_CHANNEL_ID=C0123456789
EOF
```
봇을 채널에 초대합니다: `/invite @봇이름`

**DM 모드** — 봇과의 다이렉트 메시지 스레드:
```bash
mkdir -p ~/.claude/channels/slack
cat > ~/.claude/channels/slack/.env << 'EOF'
CLAUDE_SLACK_BOT_TOKEN=xoxb-봇-토큰
CLAUDE_SLACK_APP_TOKEN=xapp-앱-토큰
CLAUDE_SLACK_DM_USER_ID=U사용자ID
EOF
```
Slack에서 사용자 ID 확인: **프로필 > ⋮ > 멤버 ID 복사**

### 3. MCP 서버 등록

`~/.claude/settings.json` (전역) 또는 `.mcp.json` (프로젝트별)에 추가:

```json
{
  "mcpServers": {
    "slack-channel": {
      "command": "bun",
      "args": ["run", "/path/to/claude-channels/plugins/slack/server.ts"]
    }
  }
}
```

### 4. 세션 시작

Claude Code를 실행합니다. 플러그인이 설정된 채널(또는 DM)에 새 스레드를 생성합니다. 해당 스레드에서 메시지를 보내 Claude와 대화합니다.

## 도구

| 도구 | 설명 |
|------|------|
| `reply` | 스레드에 메시지 전송 (파일 첨부 가능) |
| `react` | 메시지에 이모지 리액션 추가 |
| `edit_message` | 이전에 보낸 메시지 수정 |
| `download_attachment` | 메시지의 파일 첨부 다운로드 |
| `fetch_messages` | 스레드의 최근 메시지 기록 조회 |

## 동작 방식

- 각 세션은 **전용 스레드**를 생성합니다 — 모든 통신은 해당 스레드로 한정됩니다
- 스레드의 수신 메시지가 MCP 알림으로 Claude Code에 전달됩니다
- Claude는 위의 도구를 사용하여 답장, 리액션, 대화를 관리합니다
- 바인딩된 스레드 외부의 메시지는 무시됩니다

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `CLAUDE_SLACK_BOT_TOKEN` | 예 | Bot User OAuth Token (`xoxb-...`) |
| `CLAUDE_SLACK_APP_TOKEN` | 예 | `connections:write` scope의 App-Level Token (`xapp-...`) |
| `CLAUDE_SLACK_CHANNEL_ID` | 둘 중 하나 | 채널 스레드 모드용 채널 ID (`C...`) |
| `CLAUDE_SLACK_DM_USER_ID` | 둘 중 하나 | DM 스레드 모드용 Slack 사용자 ID (`U...`) |

`CLAUDE_SLACK_CHANNEL_ID` (채널 모드) 또는 `CLAUDE_SLACK_DM_USER_ID` (DM 모드) 중 하나를 설정합니다. 둘 다 설정된 경우 채널 모드가 우선합니다.

인증 정보는 `~/.claude/channels/slack/.env`에서 로드됩니다. 환경 변수가 파일보다 우선합니다.

## 문서

자세한 가이드는 [문서 사이트](https://claude-channels.pleaseai.dev)를 참고하세요:

- [Slack 설정 가이드](https://claude-channels.pleaseai.dev/getting-started/slack-setup) — Slack 앱 생성, scope 및 이벤트 설정
- [사용 가이드](https://claude-channels.pleaseai.dev/getting-started/usage) — 메시징, 첨부 파일, 도구 레퍼런스, 문제 해결

## 개발

```bash
bun run --filter claude-channel-slack dev   # 개발 모드 실행
bun test plugins/slack/                     # 테스트 실행
```
