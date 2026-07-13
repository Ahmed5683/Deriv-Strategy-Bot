# Deriv Step Index Trading Bot

An automated trading bot that scans 5 Deriv Step Index synthetic symbols, trades them via a Stochastic RSI + MACD + DPO strategy, and shows live signal/trade status on a dashboard.

## Run & Operate

- API server workflow runs `python3 server.py` directly (FastAPI + uvicorn) from `artifacts/api-server`
- Dashboard workflow runs `pnpm --filter @workspace/dashboard run dev`
- `pnpm run typecheck` — full typecheck across all packages (dashboard only; api-server is pure Python)
- Required secrets: `DERIV_APP_ID`, `DERIV_TOKEN` — Deriv API credentials (demo account trading is used by default)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9 (dashboard frontend only)
- Backend: Python 3.11, FastAPI, uvicorn, `websockets`, `httpx` — NOT the standard Node/Express/Drizzle backend. No OpenAPI codegen, no generated React Query hooks; the dashboard calls the Python REST endpoints directly with `fetch`/TanStack Query.
- Frontend: React + Vite, Tailwind, shadcn/radix components

## Where things live

- `artifacts/api-server/server.py` — entire backend: Deriv WebSocket candle fetching, indicator math (Stochastic RSI, MACD, DPO), strategy/entry logic, auto-trade execution (REST OTP auth + WS proposal/buy), FastAPI routes, background scanner loop (runs every ~60s)
- `artifacts/dashboard/` — React dashboard (overview, per-symbol chart drill-down, settings/config view)

## Architecture decisions

- The API server is Python/FastAPI, not the monorepo's default Node/Express backend — inherited from the source bot template and kept because the trading logic (WebSocket streaming, async scan loop) was already implemented there. `artifact.toml`'s `run` command was changed to `python3 server.py`; `package.json` was stripped to a stub only for pnpm workspace discovery.
- Auto-trading defaults to the **demo account only** (`TRADE_ON_DEMO_ONLY=true`). Do not flip this to real-money trading without explicit user confirmation.
- Strategy (see `.agents/memory/deriv-trading-strategy.md` for the full spec): BUY requires DPO(250) > 0, Stochastic RSI(150,120,55,9) %K and %D both <= 20, and MACD(21,55,36) line just turned upward while still below its signal line. SELL is the symmetric mirror. Old EMA/Aroon/ADX indicators and Boom/Crash symbols were fully removed.
- Risk per trade (same across all 5 Step Index symbols): $1 stake, $1 stop loss, $1.2 take profit. 300s cooldown per symbol between trades.

## Product

- Live dashboard showing all 5 Step Index symbols with current signal state, indicator readouts, a live trade feed, and read-only trading config — purely observational, no manual trade controls (the bot trades autonomously).

## User preferences

- Keep the original Deriv API connection/auth/order-placement code untouched when modifying strategy logic.

## Gotchas

- The API server artifact's `run`/`build` commands execute with the artifact's own directory as the working directory already — do not `cd artifacts/api-server` inside the command (it will fail with "can't cd to artifacts/api-server").
- Python packages (`fastapi`, `uvicorn[standard]`, `websockets==10.3`, `httpx`) are installed at the workspace root via `installLanguagePackages`, not in a per-artifact venv.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `.agents/memory/deriv-trading-strategy.md` for the full indicator/strategy spec
