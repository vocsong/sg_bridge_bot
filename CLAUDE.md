# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multiplayer Singaporean Floating Bridge card game running on Cloudflare Workers with Durable Objects for state management and WebSocket for real-time communication.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start local dev server (simulates Durable Objects)
npm run deploy    # Deploy to Cloudflare Workers (requires wrangler login)
npm run typecheck # TypeScript type check without compiling
npm run test      # Run vitest (no tests currently exist)
```

## Architecture

### Backend (Cloudflare Workers + Durable Objects)

- **`src/index.ts`** — Worker entry point. Routes `POST /api/create` (generates room code, provisions DO) and `/api/ws` (upgrades to WebSocket, delegates to DO).
- **`src/game-room.ts`** — The Durable Object. One instance per room. Holds the full `GameState` in DO storage, manages the WebSocket connections for all 4 players, and runs the entire game state machine (lobby → bidding → partner selection → play → game over).
- **`src/bridge.ts`** — Pure game logic: deck shuffling, hand generation (with wash/redeal rule for weak hands), point calculation, valid card determination, trick winner comparison.
- **`src/types.ts`** — `GameState`, `PlayerGameView`, `Player`, `Hand`, `TrickRecord` interfaces; constants (`NUM_PLAYERS=4`, `MAX_BID=34`).
- **`src/protocol.ts`** — Union types for all WebSocket messages (client→server and server→client).

### Frontend (Vanilla JS SPA)

- **`static/app.js`** — Connects via WebSocket, sends/receives messages, handles all screen transitions, auto-reconnects with exponential backoff.
- **`static/index.html`** — 6 screen states: home, lobby, bidding, partner selection, play, game-over.
- **`static/style.css`** — CSS-only card rendering (no images), dark glassmorphism theme.

### Key Design Decisions

**Server-authoritative state:** All game state lives on the Durable Object. Each player's `PlayerGameView` contains only their own hand; others' hands are null. The partner identity is whispered privately.

**One DO per room:** `env.GAME_ROOM.getByName(roomCode)` — the room code is the DO name/key.

**WebSocket flow:** Client connects with `?room=CODE&playerId=ID` → Worker delegates `fetch()` to DO → DO accepts WebSocket via `server.accept()`. Same `playerId` on reconnect restores the session.

**Inactivity cleanup:** If all players disconnect, the DO sets a 5-minute alarm. On alarm, if still empty, all DO storage is purged.

### WebSocket Protocol

Client → Server:
```
join | bid | pass | selectPartner | playCard | playAgain
```

Server → Client:
```
state          # Full PlayerGameView (sent on reconnect and state changes)
joined | bidMade | bidWon | cardPlayed | trickWon | gameOver
youArePartner  # Whispered only to the partner
playerDisconnected | playerReconnected
```

### Game Rules Summary

- 4 players, 13 cards each; hands with ≤4 points are redealt
- Bidding: levels 1–7 × suits (♣ < ♦ < ♥ < ♠ < 🚫 no-trump), encoded as integers 0–34
- Bidder calls a card to designate their partner (secret until that card is played)
- Must follow suit; can't lead trump until trump has been broken
- Win condition: bidder + partner win ≥ (bid level + 6) tricks

## Legacy Code

The root-level Python files (`bridge.py`, `handlers.py`, `main.py`, etc.) are an archived Telegram bot implementation. `bridge.py` was the original source of truth for game logic, which was ported to `bridge.ts`. The Python code is not actively deployed.
