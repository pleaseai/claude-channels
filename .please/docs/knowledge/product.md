# Product Guide

## Vision

claude-channels is a collection of channel plugins that bridge external chat platforms (Slack, Line, etc.) with Claude Code sessions. Each plugin is an MCP server that enables two-way messaging — users send messages from their preferred chat platform, and Claude replies back through the same channel.

## Target Users

- **Developers** who use Claude Code and want to interact with it from chat platforms
- **Teams** that want to integrate Claude Code into their existing Slack/Line workflows

## Core Features

- **Two-way messaging** — Receive messages from chat platforms and reply back through the same channel
- **Thread-bound sessions** — Each session creates a dedicated Slack thread for isolated communication
- **Multi-platform support** — Pluggable architecture for Slack, Line, and future platforms
- **Local-first** — Runs as a local subprocess with no public endpoints required
- **File attachments** — Send and receive files through the channel
- **Message operations** — React, edit, and thread messages

## Architecture

Each channel plugin follows the single-file MCP server pattern (`server.ts`) implementing the Claude Code Channels protocol. Plugins are organized as a Bun workspace monorepo under `plugins/`.

## Success Criteria

- Slack plugin fully functional with all documented features
- Clean plugin architecture that makes adding new platforms straightforward
- Security: sender gating, outbound gating, prompt injection defense
