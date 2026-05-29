---
id: SPEC-001
level: V_M
domain: plugins
feature: github
depends: []
conflicts: []
traces: []
created_at: 2026-05-29T20:28:07.728Z
updated_at: 2026-05-29T20:28:07.728Z
source_tracks: ["github-app-webhook-20260530"]
---

# Github Specification

## Purpose

Github Specification 관련 요구사항.

## Requirements

### Requirement: **Transport selection.** A config/env switch (e.g.
<!-- req: REQ-001 tracks=github-app-webhook-20260530 -->

The system MUST **Transport selection.** A config/env switch (e.g.

#### Scenario: **Transport selection.** A config/env switch (e.g.

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Transport selection.** A config/env switch (e.g.
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **GitHub App authentication.** In webhook mode, authenticate as a
<!-- req: REQ-002 tracks=github-app-webhook-20260530 -->

The system MUST **GitHub App authentication.** In webhook mode, authenticate as a.

#### Scenario: **GitHub App authentication.** In webhook mode, authenticate as a

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **GitHub App authentication.** In webhook mode, authenticate as a
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Manual App provisioning.** The user creates the GitHub App in the
<!-- req: REQ-003 tracks=github-app-webhook-20260530 -->

The system MUST **Manual App provisioning.** The user creates the GitHub App in the.

#### Scenario: **Manual App provisioning.** The user creates the GitHub App in the

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Manual App provisioning.** The user creates the GitHub App in the
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Local webhook receiver.** Run a local HTTP server that accepts
<!-- req: REQ-004 tracks=github-app-webhook-20260530 -->

The system MUST **Local webhook receiver.** Run a local HTTP server that accepts.

#### Scenario: **Local webhook receiver.** Run a local HTTP server that accepts

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Local webhook receiver.** Run a local HTTP server that accepts
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Signature verification.** Every inbound request is verified against
<!-- req: REQ-005 tracks=github-app-webhook-20260530 -->

The system MUST **Signature verification.** Every inbound request is verified against.

#### Scenario: **Signature verification.** Every inbound request is verified against

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Signature verification.** Every inbound request is verified against
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Event handling — `issue_comment`.** Handle `issue_comment` events
<!-- req: REQ-006 tracks=github-app-webhook-20260530 -->

The system MUST **Event handling — `issue_comment`.** Handle `issue_comment` events.

#### Scenario: **Event handling — `issue_comment`.** Handle `issue_comment` events

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Event handling — `issue_comment`.** Handle `issue_comment` events
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Cloudflare tunnel — quick (default).** Spawn `cloudflared` to create
<!-- req: REQ-007 tracks=github-app-webhook-20260530 -->

The system MUST **Cloudflare tunnel — quick (default).** Spawn `cloudflared` to create.

#### Scenario: **Cloudflare tunnel — quick (default).** Spawn `cloudflared` to create

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Cloudflare tunnel — quick (default).** Spawn `cloudflared` to create
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Cloudflare tunnel — named (configurable).** When named-tunnel config
<!-- req: REQ-008 tracks=github-app-webhook-20260530 -->

The system MUST **Cloudflare tunnel — named (configurable).** When named-tunnel config.

#### Scenario: **Cloudflare tunnel — named (configurable).** When named-tunnel config

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Cloudflare tunnel — named (configurable).** When named-tunnel config
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Webhook URL auto-registration.** On startup, after the tunnel URL is
<!-- req: REQ-009 tracks=github-app-webhook-20260530 -->

The system MUST **Webhook URL auto-registration.** On startup, after the tunnel URL is.

#### Scenario: **Webhook URL auto-registration.** On startup, after the tunnel URL is

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Webhook URL auto-registration.** On startup, after the tunnel URL is
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Tunnel lifecycle management.** The `cloudflared` subprocess is
<!-- req: REQ-010 tracks=github-app-webhook-20260530 -->

The system MUST **Tunnel lifecycle management.** The `cloudflared` subprocess is.

#### Scenario: **Tunnel lifecycle management.** The `cloudflared` subprocess is

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Tunnel lifecycle management.** The `cloudflared` subprocess is
- THEN 해당 기능이 정상적으로 수행된다

### Requirement: **Outbound parity.** `reply`, `react`, `edit_message`, and
<!-- req: REQ-011 tracks=github-app-webhook-20260530 -->

The system MUST **Outbound parity.** `reply`, `react`, `edit_message`, and.

#### Scenario: **Outbound parity.** `reply`, `react`, `edit_message`, and

- GIVEN 시스템이 정상 동작 중일 때
- WHEN **Outbound parity.** `reply`, `react`, `edit_message`, and
- THEN 해당 기능이 정상적으로 수행된다

## Non-functional Requirements

### Requirement: **Non-breaking.** With `CLAUDE_GITHUB_TRANSPORT` unset, behavior is
<!-- req: REQ-012 tracks=github-app-webhook-20260530 -->

The system SHOULD **Non-breaking.** With `CLAUDE_GITHUB_TRANSPORT` unset, behavior is.

### Requirement: **Security invariants preserved.** Sender gating on commenter login,
<!-- req: REQ-013 tracks=github-app-webhook-20260530 -->

The system SHOULD **Security invariants preserved.** Sender gating on commenter login,.

### Requirement: **Testability.** Transport selection, signature verification, event→
<!-- req: REQ-014 tracks=github-app-webhook-20260530 -->

The system SHOULD **Testability.** Transport selection, signature verification, event→.

### Requirement: **Single-file convention.** Implementation stays within the plugin's
<!-- req: REQ-015 tracks=github-app-webhook-20260530 -->

The system SHOULD **Single-file convention.** Implementation stays within the plugin's.
