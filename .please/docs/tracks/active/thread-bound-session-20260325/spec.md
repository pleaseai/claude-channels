# Thread-Bound Session

> Track: thread-bound-session-20260325

## Overview

Claude Code 세션이 시작될 때 지정된 Slack 채널에 새 thread를 생성하고, 해당 thread에만 메시지를 주고받는 기능. 모든 세션은 항상 thread에 바인딩되며, thread 외부 메시지는 무시된다.

## Requirements

### Functional Requirements

- [ ] FR-1: MCP 서버 기동 시 `SLACK_CHANNEL_ID` 환경변수로 지정된 채널에 새 thread를 생성한다
- [ ] FR-2: Thread 생성 시 시작 메시지를 기록하고, 해당 메시지의 `ts`를 thread 식별자(`thread_ts`)로 사용한다
- [ ] FR-3: 인바운드 메시지 필터링 — `thread_ts`가 바인딩된 thread와 일치하는 메시지만 수신한다
<<<<<<< HEAD
- [ ] FR-4: 아웃바운드 메시지 강제 — reply 도구는 항상 바인딩된 thread에 응답한다 (`thread_ts` 자동 설정). 도구 스키마에서 `chat_id`/`channel` 파라미터를 제거하여 모델이 다른 채널을 지정할 수 없도록 한다
- [ ] FR-5: 파일 첨부 수신/전송 지원 (thread 내)
- [ ] FR-6: react 도구는 바인딩된 thread 내 메시지에만 작동한다. 도구 스키마에서 `chat_id`/`channel` 파라미터를 제거한다
- [ ] FR-7: edit_message 도구는 바인딩된 thread 내 메시지에만 작동한다. 도구 스키마에서 `chat_id`/`channel` 파라미터를 제거한다
=======
- [ ] FR-4: 아웃바운드 메시지 강제 — reply 도구는 항상 바인딩된 thread에 응답한다 (`thread_ts` 자동 설정)
- [ ] FR-5: 파일 첨부 수신/전송 지원 (thread 내)
- [ ] FR-6: react 도구는 바인딩된 thread 내 메시지에만 작동한다
- [ ] FR-7: edit_message 도구는 바인딩된 thread 내 메시지에만 작동한다
>>>>>>> 2f81525 (docs(track): add thread-bound-session-20260325 track)
- [ ] FR-8: `SLACK_CHANNEL_ID`가 없으면 서버 기동 시 에러로 종료한다

### Non-functional Requirements

- [ ] NFR-1: 기존 single-file MCP 서버 아키텍처(`server.ts`) 유지
<<<<<<< HEAD
- [ ] NFR-2: 파일 다운로드(inbox) 등 상태 파일은 `~/.claude/channels/slack/`에 atomic write(tmp→rename)로 저장. `boundThreadTs`는 재시작 시 새 thread를 생성하므로 영속화하지 않는다
=======
- [ ] NFR-2: 상태 파일은 `~/.claude/channels/slack/`에 atomic write로 저장
>>>>>>> 2f81525 (docs(track): add thread-bound-session-20260325 track)

## Acceptance Criteria

- [ ] AC-1: 서버 기동 시 지정 채널에 thread 시작 메시지가 생성된다
- [ ] AC-2: Thread 외부 메시지는 수신되지 않는다
- [ ] AC-3: reply/react/edit 모두 바인딩된 thread 내에서만 동작한다
- [ ] AC-4: `SLACK_CHANNEL_ID` 없이 시작하면 명확한 에러 메시지와 함께 종료된다
- [ ] AC-5: 동일 Bot으로 여러 세션을 동시 실행해도 각 세션이 자신의 thread만 처리한다

## Out of Scope

- 기존 unbound 모드 유지 (항상 thread-bound)
- DM 기반 pairing/allowlist 메커니즘
- 여러 thread에 동시 바인딩

## Assumptions

- Slack Bot이 해당 채널에 초대되어 있어야 한다
- `SLACK_CHANNEL_ID`는 Claude Code MCP 설정의 `env` 블록으로 전달된다
- Socket Mode에서 복수 연결 시 메시지가 분산되지만, thread 필터링으로 각 세션이 자기 메시지만 처리
