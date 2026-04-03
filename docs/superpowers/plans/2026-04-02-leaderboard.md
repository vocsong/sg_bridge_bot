# Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-5 leaderboard (wins + games played) to the home screen, recorded from game results for authenticated players.

**Architecture:** New D1 migration adds `wins`/`games_played` columns to `users`. A new `src/stats.ts` records results after game over. A new `GET /api/leaderboard` endpoint serves the data. Frontend fetches and renders above the login section on page load.

**Tech Stack:** Cloudflare Workers, Cloudflare D1 (SQLite), TypeScript, Vanilla JS

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `migrations/0002_stats.sql` | Add wins/games_played columns |
| Create | `src/stats.ts` | `recordGameResult` helper |
| Create | `tests/stats.test.ts` | Unit tests for stats logic |
| Modify | `src/db.ts` | Add `getLeaderboard` query + `LeaderboardEntry` type |
| Modify | `src/index.ts` | Add `GET /api/leaderboard` route |
| Modify | `src/game-room.ts` | Call `recordGameResult` after each gameOver broadcast |
| Modify | `static/index.html` | Add `#leaderboard-section` div above `#login-section` |
| Modify | `static/app.js` | Add `loadLeaderboard` + `renderLeaderboard` |
| Modify | `static/style.css` | Leaderboard styles |

---

## Task 1: D1 migration

**Files:**
- Create: `migrations/0002_stats.sql`

- [ ] **Step 1: Create the migration file**

Create `G:/sg_bridge_bot/migrations/0002_stats.sql`:
```sql
ALTER TABLE users ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply locally**

```bash
cd G:/sg_bridge_bot && npx wrangler d1 migrations apply sg-bridge-users --local 2>&1
```
Expected:
```
✅ Applied 1 migration to sg-bridge-users (local)
```

- [ ] **Step 3: Commit**

```bash
cd G:/sg_bridge_bot && git add migrations/0002_stats.sql && git commit -m "feat: add wins and games_played columns to users table"
```

---

## Task 2: src/stats.ts — recordGameResult

**Files:**
- Create: `src/stats.ts`
- Create: `tests/stats.test.ts`

- [ ] **Step 1: Write failing tests**

Create `G:/sg_bridge_bot/tests/stats.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getWinnerSeats } from '../src/stats';

describe('getWinnerSeats', () => {
  it('returns bidder and partner seats when bidder wins', () => {
    expect(getWinnerSeats(0, 2, true)).toEqual([0, 2]);
  });

  it('returns opponent seats when bidder loses', () => {
    expect(getWinnerSeats(0, 2, false)).toEqual([1, 3]);
  });

  it('returns only bidder seat when partner === bidder and bidder wins', () => {
    expect(getWinnerSeats(1, 1, true)).toEqual([1]);
  });

  it('returns all three opponents when partner === bidder and bidder loses', () => {
    expect(getWinnerSeats(1, 1, false)).toEqual([0, 2, 3]);
  });

  it('handles different seat positions', () => {
    expect(getWinnerSeats(3, 1, true)).toEqual([3, 1]);
    expect(getWinnerSeats(3, 1, false)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd G:/sg_bridge_bot && npx vitest run tests/stats.test.ts 2>&1
```
Expected: FAIL — `getWinnerSeats` not defined.

- [ ] **Step 3: Create src/stats.ts**

Create `G:/sg_bridge_bot/src/stats.ts`:
```typescript
import type { D1Database } from '@cloudflare/workers-types';
import type { Player } from './types';

/**
 * Returns the seat numbers of the winning team.
 * When partner === bidder (called their own card), bidder wins/loses alone.
 */
export function getWinnerSeats(bidder: number, partner: number, bidderWon: boolean): number[] {
  const bidderTeam = bidder === partner ? [bidder] : [bidder, partner];
  if (bidderWon) return bidderTeam;
  // opponents = all seats not in bidderTeam
  return [0, 1, 2, 3].filter((s) => !bidderTeam.includes(s));
}

/**
 * Increments wins and games_played for all authenticated players.
 * Guests (non-tg_ IDs) are silently skipped.
 */
export async function recordGameResult(
  db: D1Database,
  players: Player[],
  winnerSeats: number[],
): Promise<void> {
  await Promise.all(
    players.map((player) => {
      if (!player.id.startsWith('tg_')) return Promise.resolve();
      const telegramId = Number(player.id.slice(3));
      const won = winnerSeats.includes(player.seat) ? 1 : 0;
      return db
        .prepare(
          'UPDATE users SET games_played = games_played + 1, wins = wins + ? WHERE telegram_id = ?',
        )
        .bind(won, telegramId)
        .run();
    }),
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd G:/sg_bridge_bot && npx vitest run tests/stats.test.ts 2>&1
```
Expected: 5 tests pass.

- [ ] **Step 5: Run typecheck**

```bash
cd G:/sg_bridge_bot && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd G:/sg_bridge_bot && git add src/stats.ts tests/stats.test.ts && git commit -m "feat: add recordGameResult and getWinnerSeats helpers"
```

---

## Task 3: src/db.ts — add getLeaderboard

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: Add LeaderboardEntry type and getLeaderboard to src/db.ts**

Open `G:/sg_bridge_bot/src/db.ts`. Add the following at the end of the file:

```typescript
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  wins: number;
  gamesPlayed: number;
}

/**
 * Returns top 5 players by wins (min 1 game played) + optionally the caller's rank.
 * If telegramId is provided and not in top 5, their rank is returned separately.
 */
export async function getLeaderboard(
  db: D1Database,
  telegramId?: number,
): Promise<{ top: LeaderboardEntry[]; me: (LeaderboardEntry & { telegramId: number }) | null }> {
  const topRows = await db
    .prepare(
      `SELECT display_name, wins, games_played,
              RANK() OVER (ORDER BY wins DESC) AS rank
       FROM users
       WHERE games_played > 0
       ORDER BY wins DESC
       LIMIT 5`,
    )
    .all<{ display_name: string; wins: number; games_played: number; rank: number }>();

  const top: LeaderboardEntry[] = (topRows.results ?? []).map((r) => ({
    rank: r.rank,
    displayName: r.display_name,
    wins: r.wins,
    gamesPlayed: r.games_played,
  }));

  if (!telegramId) return { top, me: null };

  // Check if already in top 5
  const inTop = top.some((_, i) => {
    const raw = topRows.results?.[i];
    return raw && false; // we don't have telegram_id in top query — check separately
  });

  // Get caller's stats
  const meRow = await db
    .prepare(
      `SELECT display_name, wins, games_played,
              (SELECT COUNT(*) + 1 FROM users WHERE wins > u.wins) AS rank
       FROM users u
       WHERE telegram_id = ?`,
    )
    .bind(telegramId)
    .first<{ display_name: string; wins: number; games_played: number; rank: number }>();

  if (!meRow || meRow.games_played === 0) return { top, me: null };

  // Suppress me row if already in top 5 (rank <= 5)
  if (meRow.rank <= 5) return { top, me: null };

  return {
    top,
    me: {
      rank: meRow.rank,
      displayName: meRow.display_name,
      wins: meRow.wins,
      gamesPlayed: meRow.games_played,
      telegramId,
    },
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd G:/sg_bridge_bot && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd G:/sg_bridge_bot && npx vitest run 2>&1
```
Expected: all 12 tests pass (7 auth + 5 stats).

- [ ] **Step 4: Commit**

```bash
cd G:/sg_bridge_bot && git add src/db.ts && git commit -m "feat: add getLeaderboard query to db.ts"
```

---

## Task 4: src/index.ts — /api/leaderboard route

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import and route to src/index.ts**

At the top of `src/index.ts`, add `getLeaderboard` to the db import:
```typescript
import { upsertUser, getUser, updateDisplayName, getLeaderboard } from './db';
```

Add this route inside the `fetch` handler, before the `/api/create` route:
```typescript
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      const claims = await getAuthClaims(request, env.JWT_SECRET).catch(() => null);
      const telegramId = claims ? Number(claims.sub) : undefined;
      const data = await getLeaderboard(env.DB, telegramId);
      return Response.json(data);
    }
```

- [ ] **Step 2: Run typecheck**

```bash
cd G:/sg_bridge_bot && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd G:/sg_bridge_bot && npx vitest run 2>&1
```
Expected: 12 tests pass.

- [ ] **Step 4: Commit**

```bash
cd G:/sg_bridge_bot && git add src/index.ts && git commit -m "feat: add GET /api/leaderboard endpoint"
```

---

## Task 5: src/game-room.ts — call recordGameResult

**Files:**
- Modify: `src/game-room.ts`

- [ ] **Step 1: Add import to game-room.ts**

At the top of `G:/sg_bridge_bot/src/game-room.ts`, add:
```typescript
import { recordGameResult, getWinnerSeats } from './stats';
```

- [ ] **Step 2: Replace the first TODO comment (bidder won)**

Find:
```typescript
        this.broadcast({
          type: 'gameOver',
          bidderWon: true,
          winnerNames,
        });
        // TODO: record game result for stats/leaderboards when implemented
        // Example: await recordGameResult(env, state.players, { bidderWon, winnerNames })
```

Replace with:
```typescript
        this.broadcast({
          type: 'gameOver',
          bidderWon: true,
          winnerNames,
        });
        await recordGameResult(
          this.env.DB,
          state.players,
          getWinnerSeats(bidder, partner, true),
        );
```

- [ ] **Step 3: Replace the second TODO comment (bidder lost)**

Find:
```typescript
        this.broadcast({
          type: 'gameOver',
          bidderWon: false,
          winnerNames,
        });
        // TODO: record game result for stats/leaderboards when implemented
        // Example: await recordGameResult(env, state.players, { bidderWon, winnerNames })
```

Replace with:
```typescript
        this.broadcast({
          type: 'gameOver',
          bidderWon: false,
          winnerNames,
        });
        await recordGameResult(
          this.env.DB,
          state.players,
          getWinnerSeats(bidder, partner, false),
        );
```

- [ ] **Step 4: Run typecheck**

```bash
cd G:/sg_bridge_bot && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd G:/sg_bridge_bot && git add src/game-room.ts && git commit -m "feat: record game result stats after game over"
```

---

## Task 6: Frontend — HTML + JS + CSS

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/style.css`

- [ ] **Step 1: Add #leaderboard-section to index.html**

In `G:/sg_bridge_bot/static/index.html`, find the home screen container:
```html
    <div class="home-container">
      <h1>♠♥ Floating Bridge ♦♣</h1>
      <p class="subtitle">Singaporean Card Game</p>

      <!-- Telegram login section (shown when not logged in) -->
      <div id="login-section">
```

Add `#leaderboard-section` between the subtitle and `#login-section`:
```html
    <div class="home-container">
      <h1>♠♥ Floating Bridge ♦♣</h1>
      <p class="subtitle">Singaporean Card Game</p>

      <div id="leaderboard-section"></div>

      <!-- Telegram login section (shown when not logged in) -->
      <div id="login-section">
```

- [ ] **Step 2: Add loadLeaderboard and renderLeaderboard to app.js**

In `G:/sg_bridge_bot/static/app.js`, find the `// --- Auth ---` section and add these two functions immediately before it:

```javascript
// --- Leaderboard ---

async function loadLeaderboard() {
  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch('/api/leaderboard', { headers });
    if (!res.ok) return;
    renderLeaderboard(await res.json());
  } catch { /* non-critical — silent fail */ }
}

function renderLeaderboard(data) {
  const section = document.getElementById('leaderboard-section');
  if (!section) return;
  if (!data.top || data.top.length === 0) {
    section.innerHTML = '';
    return;
  }
  const medals = ['🥇', '🥈', '🥉', '', ''];
  let rows = data.top.map((e) =>
    `<div class="lb-row">
      <span class="lb-rank">${medals[e.rank - 1] || '#' + e.rank}</span>
      <span class="lb-name">${esc(e.displayName)}</span>
      <span class="lb-stats">${e.wins}W / ${e.gamesPlayed}G</span>
    </div>`
  ).join('');
  if (data.me) {
    rows += `<div class="lb-divider"></div>
    <div class="lb-row lb-me">
      <span class="lb-rank">#${data.me.rank}</span>
      <span class="lb-name">You</span>
      <span class="lb-stats">${data.me.wins}W / ${data.me.gamesPlayed}G</span>
    </div>`;
  }
  section.innerHTML = `<div class="lb-card"><div class="lb-header">🏆 Leaderboard</div>${rows}</div>`;
}
```

- [ ] **Step 3: Call loadLeaderboard on page load and after auth events**

Find the event-listeners init block near the bottom (the line `$('input-name').value = playerName;`). Add `loadLeaderboard();` immediately after `initAuth();`:

```javascript
// Kick off auth check on page load
initAuth();
loadLeaderboard();
```

Also call `loadLeaderboard()` after a successful Telegram login. Find `showGameSection(displayName);` inside `window.onTelegramAuth` and add `loadLeaderboard();` after it:
```javascript
    showGameSection(displayName);
    loadLeaderboard();
```

Also call `loadLeaderboard()` after logout. Find the logout click handler inside `showGameSection`:
```javascript
      authToken = null;
      authDisplayName = null;
      localStorage.removeItem('authToken');
      showLoginSection();
```
Add `loadLeaderboard();` after `showLoginSection();`:
```javascript
      authToken = null;
      authDisplayName = null;
      localStorage.removeItem('authToken');
      showLoginSection();
      loadLeaderboard();
```

- [ ] **Step 4: Add leaderboard styles to style.css**

Append to the end of `G:/sg_bridge_bot/static/style.css`:

```css
/* Leaderboard */
.lb-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.25rem;
}

.lb-header {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #d4a843;
  margin-bottom: 0.75rem;
  text-align: center;
}

.lb-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.9rem;
}

.lb-rank {
  width: 2rem;
  text-align: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.lb-name {
  flex: 1;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-stats {
  color: #d4a843;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.lb-me .lb-name {
  font-weight: 600;
  color: #fff;
}

.lb-divider {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 0.4rem 0;
}
```

- [ ] **Step 5: Run all tests**

```bash
cd G:/sg_bridge_bot && npx vitest run 2>&1
```
Expected: 12 tests pass.

- [ ] **Step 6: Commit**

```bash
cd G:/sg_bridge_bot && git add static/index.html static/app.js static/style.css && git commit -m "feat: add leaderboard section to home screen"
```

---

## Task 7: Deploy

- [ ] **Step 1: Apply migration to production**

```bash
cd G:/sg_bridge_bot && npx wrangler d1 migrations apply sg-bridge-users --remote 2>&1
```
Expected:
```
✅ Applied 0002_stats.sql
```

- [ ] **Step 2: Deploy**

```bash
cd G:/sg_bridge_bot && npx wrangler deploy 2>&1
```
Expected: deployment URL printed.

- [ ] **Step 3: Smoke test**

Open https://sg-bridge.vocs.workers.dev. Verify:
- Leaderboard section visible above login (shows empty or existing data)
- Guest flow unaffected
- After logging in with Telegram, leaderboard refreshes
- After playing a game, your stats appear on the board
