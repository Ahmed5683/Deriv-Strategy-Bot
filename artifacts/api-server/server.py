import asyncio
import os
import time
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import websockets
import httpx
import uvicorn

APP_ID   = os.getenv("DERIV_APP_ID", "")
TOKEN    = os.getenv("DERIV_TOKEN", "")
PORT     = int(os.getenv("PORT", "8080"))

# Old WebSocket endpoint — still used for market scanning (OHLC / tick data)
WS_URL        = "wss://ws.derivws.com/websockets/v3?app_id=1089"

# New Deriv REST base URL (v2 API)
DERIV_REST    = "https://api.derivws.com"

# ── Auto-trading settings (overridable via env) ──────────────
TRADE_STAKE        = float(os.getenv("TRADE_STAKE",        "1.0"))
TRADE_STOP_LOSS    = float(os.getenv("TRADE_STOP_LOSS",    "0.50"))
TRADE_TAKE_PROFIT  = float(os.getenv("TRADE_TAKE_PROFIT",  "1.2"))
TRADE_ON_DEMO_ONLY = os.getenv("TRADE_ON_DEMO_ONLY", "true").lower() == "true"
AUTO_TRADING_ENABLED = os.getenv("AUTO_TRADING_ENABLED", "true").lower() == "true"

# Limit concurrent WebSocket connections
_ws_semaphore = asyncio.Semaphore(15)

# ── Step Index symbols — multiplier (in brackets) is per-symbol ──
SYMBOL_CONFIG = {
    "stpRNG":  {"multiplier": 750, "name": "Step Index"},
    "stpRNG2": {"multiplier": 400, "name": "Step Index 2"},
    "stpRNG3": {"multiplier": 300, "name": "Step Index 3"},
    "stpRNG4": {"multiplier": 200, "name": "Step Index 4"},
    "stpRNG5": {"multiplier": 100, "name": "Step Index 5"},
}

# ── Strategy settings ──────────────────────────────────────────
# Stochastic RSI: RSI length 150, Stochastic length 120, smooth K 55, smooth D 9
RSI_LENGTH     = 150
STOCH_LENGTH   = 120
STOCH_SMOOTH_K = 55
STOCH_SMOOTH_D = 9
STOCH_RSI_OVERSOLD   = 20
STOCH_RSI_OVERBOUGHT = 80

# MACD: fast 21, slow 55, signal 36
MACD_FAST   = 36
MACD_SLOW   = 80
MACD_SIGNAL = 36

# Detrended Price Oscillator
DPO_PERIOD = 250

# Aroon: extra confirmation layer on top of DPO + StochRSI + MACD
AROON_PERIOD    = 350
AROON_STRONG    = 70
AROON_WEAK      = 20

CACHE_TTL           = 60

# Bars needed for every indicator to warm up (StochRSI is the hungriest:
# RSI_LENGTH + STOCH_LENGTH + STOCH_SMOOTH_K + STOCH_SMOOTH_D + buffer)
MIN_BARS_NEEDED  = max(RSI_LENGTH + STOCH_LENGTH + STOCH_SMOOTH_K + STOCH_SMOOTH_D + 20,
                       AROON_PERIOD + 20)
ANALYSIS_CANDLES = max(900, MIN_BARS_NEEDED + 50)
CHART_CANDLES    = ANALYSIS_CANDLES + 200

_analysis_cache:      Optional[Dict] = None
_analysis_cache_time: float = 0
_chart_cache:         Dict[str, Dict]  = {}
_chart_cache_time:    Dict[str, float] = {}
_trade_log:      List[Dict] = []
# Per-symbol epoch of the latest candle already traded on — ensures at most
# one trade per symbol per candle, regardless of how many scans run before
# that candle closes (replaces the old pure time-based cooldown lookback).
_traded_candle_epoch: Dict[str, int] = {}


# ──────────────────────────────────────────────────
# WebSocket helpers
# ──────────────────────────────────────────────────

async def ws_send_recv(ws, payload: Dict, timeout: float = 15.0) -> Dict:
    await ws.send(json.dumps(payload))
    resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
    if resp.get("error"):
        raise RuntimeError(resp["error"].get("message", "Unknown error"))
    return resp


async def _fetch_candles_once(symbol: str, count: int, granularity: int = 60) -> List[Dict]:
    async def _do():
        async with websockets.connect(WS_URL, open_timeout=15) as ws:
            return await ws_send_recv(ws, {
                "ticks_history": symbol,
                "adjust_start_time": 1,
                "count": count,
                "end": "latest",
                "granularity": granularity,
                "style": "candles",
            }, timeout=15.0)
    async with _ws_semaphore:
        resp = await asyncio.wait_for(_do(), timeout=25)
    return resp.get("candles", [])


async def fetch_candles_ws(symbol: str, count: int, granularity: int = 60) -> List[Dict]:
    """Fetch with one automatic retry and a hard per-attempt timeout."""
    try:
        return await _fetch_candles_once(symbol, count, granularity)
    except Exception as e:
        await asyncio.sleep(2)
        try:
            return await _fetch_candles_once(symbol, count, granularity)
        except Exception as e2:
            raise RuntimeError(f"fetch failed after 2 attempts: {e2}") from e2


# ──────────────────────────────────────────────────
# Indicators — Stochastic RSI, MACD, DPO
# ──────────────────────────────────────────────────

def _ema_series(values: List[float], period: int) -> List[float]:
    """Exponential Moving Average. Returns list aligned with values[period-1:]."""
    if len(values) < period:
        return []
    k    = 2.0 / (period + 1)
    seed = sum(values[:period]) / period
    out  = [seed]
    for v in values[period:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def _sma_series(values: List[float], period: int) -> List[float]:
    """Simple Moving Average. Returns list aligned with values[period-1:]."""
    if len(values) < period:
        return []
    out = []
    for i in range(period - 1, len(values)):
        out.append(sum(values[i - period + 1:i + 1]) / period)
    return out


def _rsi_series(closes: List[float], period: int) -> List[float]:
    """Wilder RSI. Returns list aligned with closes[period:]."""
    if len(closes) < period + 1:
        return []
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    rsi_vals: List[float] = []

    def _rsi_from(avg_g: float, avg_l: float) -> float:
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return 100 - (100 / (1 + rs))

    rsi_vals.append(_rsi_from(avg_gain, avg_loss))
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rsi_vals.append(_rsi_from(avg_gain, avg_loss))

    return rsi_vals


def calc_stoch_rsi(closes: List[float]) -> Dict:
    """Stochastic RSI — RSI(150) -> Stochastic(120) -> smooth K(55) -> smooth D(9).

    %K <= 20 -> oversold (buy zone). %K >= 80 -> overbought (sell zone).
    """
    rsi_vals = _rsi_series(closes, RSI_LENGTH)
    if len(rsi_vals) < STOCH_LENGTH:
        return {"k": None, "d": None, "oversold": False, "overbought": False,
                "k_values": [], "d_values": []}

    stoch_vals: List[float] = []
    for i in range(STOCH_LENGTH - 1, len(rsi_vals)):
        window   = rsi_vals[i - STOCH_LENGTH + 1:i + 1]
        lo, hi   = min(window), max(window)
        rng      = hi - lo
        stoch_vals.append(0.0 if rng == 0 else (rsi_vals[i] - lo) / rng * 100)

    k_vals = _sma_series(stoch_vals, STOCH_SMOOTH_K)
    d_vals = _sma_series(k_vals, STOCH_SMOOTH_D)

    if not k_vals or not d_vals:
        return {"k": None, "d": None, "oversold": False, "overbought": False,
                "k_values": [], "d_values": []}

    k_curr = round(k_vals[-1], 2)
    d_curr = round(d_vals[-1], 2)

    return {
        "k":          k_curr,
        "d":          d_curr,
        "oversold":   k_curr <= STOCH_RSI_OVERSOLD   and d_curr <= STOCH_RSI_OVERSOLD,
        "overbought": k_curr >= STOCH_RSI_OVERBOUGHT and d_curr >= STOCH_RSI_OVERBOUGHT,
        "k_values":   [round(v, 2) for v in k_vals[-100:]],
        "d_values":   [round(v, 2) for v in d_vals[-100:]],
    }


def calc_macd(closes: List[float]) -> Dict:
    """MACD(21, 55, 36).

    Histogram = MACD line - signal line.
    bullish_turn: histogram crossed from bearish (below 0, MACD under signal)
                  on the PREVIOUS bar to bullish (above 0, MACD over signal)
                  on the CURRENT bar — a genuine MACD/signal crossover, buy.
    bearish_turn: histogram crossed from bullish (above 0) on the previous
                  bar to bearish (below 0) on the current bar — sell.
    """
    fast_ema = _ema_series(closes, MACD_FAST)
    slow_ema = _ema_series(closes, MACD_SLOW)
    if not fast_ema or not slow_ema:
        return {"macd": None, "signal": None, "bullish_turn": False,
                "bearish_turn": False, "macd_values": [], "signal_values": []}

    # Align both EMA series to the same (later) starting close index.
    offset = len(fast_ema) - len(slow_ema)
    fast_aligned = fast_ema[offset:] if offset > 0 else fast_ema
    slow_aligned = slow_ema[-offset:] if offset < 0 else slow_ema
    macd_line = [f - s for f, s in zip(fast_aligned, slow_aligned)]

    signal_line = _ema_series(macd_line, MACD_SIGNAL)
    if len(signal_line) < 2 or len(macd_line) < 2:
        return {"macd": None, "signal": None, "bullish_turn": False,
                "bearish_turn": False, "macd_values": [], "signal_values": []}

    # Align macd_line to signal_line's window for the "vs signal" comparison.
    macd_aligned = macd_line[-len(signal_line):]

    macd_curr, macd_prev = macd_aligned[-1], macd_aligned[-2]
    signal_curr, signal_prev = signal_line[-1], signal_line[-2]

    hist_curr = macd_curr - signal_curr
    hist_prev = macd_prev - signal_prev

    bullish_turn = (hist_prev < 0) and (hist_curr > 0)   # bearish bar -> bullish bar
    bearish_turn = (hist_prev > 0) and (hist_curr < 0)   # bullish bar -> bearish bar

    return {
        "macd":           round(macd_curr, 5),
        "signal":         round(signal_curr, 5),
        "histogram":      round(hist_curr, 5),
        "bullish_turn":   bullish_turn,
        "bearish_turn":   bearish_turn,
        "macd_values":    [round(v, 5) for v in macd_aligned[-100:]],
        "signal_values":  [round(v, 5) for v in signal_line[-100:]],
    }


def calc_dpo(closes: List[float], period: int = DPO_PERIOD) -> Dict:
    """Detrended Price Oscillator.

    shift = period // 2 + 1  (= 126 for period=250)
    DPO[i] = close[i] - SMA(close[i-shift-period+1 : i-shift+1])
    """
    shift  = period // 2 + 1
    needed = period + shift

    if len(closes) < needed + 1:
        return {"value": None, "positive": False, "negative": False, "values": []}

    dpo_vals: List[float] = []
    for i in range(needed - 1, len(closes)):
        sma_end   = i - shift + 1
        sma_start = sma_end - period
        if sma_start < 0:
            continue
        sma = sum(closes[sma_start:sma_end]) / period
        dpo_vals.append(closes[i] - sma)

    if not dpo_vals:
        return {"value": None, "positive": False, "negative": False, "values": []}

    current = dpo_vals[-1]

    return {
        "value":    round(current, 4),
        "positive": current > 0,
        "negative": current < 0,
        "values":   [round(v, 4) for v in dpo_vals[-100:]],
    }


def calc_aroon(highs: List[float], lows: List[float], period: int = AROON_PERIOD) -> Dict:
    """Aroon(350) — extra confirmation layer.

    Aroon Up   = ((period - bars since highest high in window) / period) * 100
    Aroon Down = ((period - bars since lowest low in window) / period) * 100

    buy_confirmed:  Aroon Up   > 70  AND Aroon Down < 20
    sell_confirmed: Aroon Down > 70  AND Aroon Up   < 20
    """
    window = period + 1
    if len(highs) < window or len(lows) < window:
        return {"up": None, "down": None, "buy_confirmed": False, "sell_confirmed": False}

    window_highs = highs[-window:]
    window_lows  = lows[-window:]

    # index 0 = oldest bar in window, index `period` = current bar
    idx_high = window_highs.index(max(window_highs))
    idx_low  = window_lows.index(min(window_lows))

    bars_since_high = period - idx_high
    bars_since_low  = period - idx_low

    aroon_up   = ((period - bars_since_high) / period) * 100
    aroon_down = ((period - bars_since_low) / period) * 100

    return {
        "up":             round(aroon_up, 2),
        "down":           round(aroon_down, 2),
        "buy_confirmed":  aroon_up > AROON_STRONG and aroon_down < AROON_WEAK,
        "sell_confirmed": aroon_down > AROON_STRONG and aroon_up < AROON_WEAK,
    }


# ──────────────────────────────────────────────────
# Analysis
# ──────────────────────────────────────────────────

async def analyze_symbol(symbol: str, config: Dict) -> Optional[Dict]:
    try:
        candles = await fetch_candles_ws(symbol, ANALYSIS_CANDLES)
        if len(candles) < MIN_BARS_NEEDED:
            return None

        closes = [float(c["close"]) for c in candles]
        highs  = [float(c["high"])  for c in candles]
        lows   = [float(c["low"])   for c in candles]
        price  = closes[-1]
        candle_epoch = candles[-1].get("epoch")

        stoch_rsi = calc_stoch_rsi(closes)
        macd      = calc_macd(closes)
        dpo       = calc_dpo(closes, DPO_PERIOD)
        aroon     = calc_aroon(highs, lows, AROON_PERIOD)

        signal = "NONE"
        if (dpo.get("positive") and stoch_rsi.get("oversold") and macd.get("bullish_turn")
                and aroon.get("buy_confirmed")):
            signal = "BUY"
        elif (dpo.get("negative") and stoch_rsi.get("overbought") and macd.get("bearish_turn")
                and aroon.get("sell_confirmed")):
            signal = "SELL"

        return {
            "symbol":       symbol,
            "name":         config["name"],
            "multiplier":   config["multiplier"],
            "price":        round(price, 4),
            "stoch_rsi":    stoch_rsi,
            "macd":         macd,
            "dpo":          dpo,
            "aroon":        aroon,
            "signal":       signal,
            "candle_epoch": candle_epoch,
            "last_updated": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        print(f"[SCAN ERROR] {symbol}: {e}")
        return None


async def run_full_analysis() -> Dict:
    symbols_list = list(SYMBOL_CONFIG.items())
    tasks        = [analyze_symbol(symbol, config) for symbol, config in symbols_list]
    all_results  = await asyncio.gather(*tasks, return_exceptions=True)

    results: List[Dict] = []
    failed:  List[str]  = []
    skipped: List[str]  = []
    for (symbol, _), r in zip(symbols_list, all_results):
        if isinstance(r, dict):
            results.append(r)
        elif r is None:
            skipped.append(symbol)
        else:
            failed.append(f"{symbol}({r})")

    if skipped:
        print(f"[SCAN SKIP]  no/insufficient candles: {', '.join(skipped)}")
    if failed:
        print(f"[SCAN FAIL]  exceptions: {', '.join(failed)}")
    print(f"[SCAN OK]    {len(results)}/{len(symbols_list)} symbols succeeded")

    if AUTO_TRADING_ENABLED:
        await asyncio.gather(*[_trigger_trade_if_confirmed(r) for r in results])

    buy_count  = sum(1 for r in results if r["signal"] == "BUY")
    sell_count = sum(1 for r in results if r["signal"] == "SELL")

    return {
        "timestamp":  datetime.utcnow().isoformat(),
        "buy_count":  buy_count,
        "sell_count": sell_count,
        "symbols":    results,
    }


async def build_chart_data(symbol: str) -> Dict:
    candles = await fetch_candles_ws(symbol, CHART_CANDLES)
    closes  = [float(c["close"]) for c in candles]

    stoch_rsi = calc_stoch_rsi(closes)
    macd      = calc_macd(closes)
    dpo       = calc_dpo(closes, DPO_PERIOD)

    candle_data = [
        {"time": c["epoch"], "open": float(c["open"]), "high": float(c["high"]),
         "low": float(c["low"]), "close": float(c["close"])}
        for c in candles
    ]
    return {
        "symbol":       symbol,
        "candles":      candle_data,
        "stoch_rsi":    stoch_rsi,
        "macd":         macd,
        "dpo":          dpo,
        "bar_count":    len(candles),
        "last_updated": datetime.utcnow().isoformat(),
    }


# ──────────────────────────────────────────────────
# Auto-trading engine (Deriv API v2)
# ──────────────────────────────────────────────────

async def _get_authenticated_ws_url() -> str:
    """Use new Deriv REST API to get an OTP-authenticated WebSocket URL.

    Flow:
      1. GET /trading/v1/options/accounts  → pick demo or real account
      2. POST /trading/v1/options/accounts/{id}/otp → get authenticated WS URL
    """
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Deriv-App-ID":  APP_ID,
        "Content-Type":  "application/json",
    }
    target_type = "demo" if TRADE_ON_DEMO_ONLY else "real"

    async with httpx.AsyncClient(timeout=15) as client:
        # Step 1 — list accounts
        resp = await client.get(f"{DERIV_REST}/trading/v1/options/accounts", headers=headers)
        if resp.status_code != 200:
            raise RuntimeError(f"GET accounts failed {resp.status_code}: {resp.text}")
        accounts = resp.json().get("data", [])

        account = next(
            (a for a in accounts if a.get("account_type") == target_type and a.get("status") == "active"),
            None
        )
        if not account:
            raise RuntimeError(
                f"No active {target_type} account found. "
                f"Available: {[a.get('account_type') for a in accounts]}"
            )

        account_id = account["account_id"]
        print(f"[TRADE]     Using account {account_id} ({target_type}), "
              f"balance={account.get('balance')} {account.get('currency')}")

        # Step 2 — get OTP → authenticated WS URL
        otp_resp = await client.post(
            f"{DERIV_REST}/trading/v1/options/accounts/{account_id}/otp",
            headers=headers,
        )
        if otp_resp.status_code not in (200, 201):
            raise RuntimeError(f"OTP request failed {otp_resp.status_code}: {otp_resp.text}")

        ws_url = otp_resp.json()["data"]["url"]
        print(f"[TRADE]     Authenticated WS URL obtained")
        return ws_url


async def _place_multiplier_trade(symbol: str, contract_type: str) -> Dict:
    """Place MULTUP or MULTDOWN via Deriv API v2 WebSocket."""
    if not TOKEN or not APP_ID:
        return {"ok": False,
                "error": "DERIV_TOKEN and DERIV_APP_ID not configured",
                "contract_type": contract_type, "symbol": symbol}

    # Get a fresh OTP-authenticated WebSocket URL
    try:
        trade_ws = await _get_authenticated_ws_url()
    except Exception as e:
        return {"ok": False, "error": f"Auth setup failed: {e}",
                "contract_type": contract_type, "symbol": symbol}

    multiplier = SYMBOL_CONFIG[symbol]["multiplier"]
    last_error = "unknown"

    for attempt in range(3):
        try:
            async with websockets.connect(
                trade_ws,
                open_timeout=20,
                ping_interval=None,
            ) as ws:
                # No authorize step needed — OTP URL is pre-authenticated

                prop_resp = await ws_send_recv(ws, {
                    "proposal":           1,
                    "amount":             TRADE_STAKE,
                    "basis":              "stake",
                    "contract_type":      contract_type,
                    "currency":           "USD",
                    "underlying_symbol":  symbol,
                    "multiplier":         multiplier,
                    "limit_order":        {"stop_loss": TRADE_STOP_LOSS,
                                          "take_profit": TRADE_TAKE_PROFIT},
                }, timeout=20.0)

                if prop_resp.get("error"):
                    err_msg = prop_resp["error"].get("message", str(prop_resp["error"]))
                    return {"ok": False, "error": f"Proposal failed: {err_msg}",
                            "contract_type": contract_type, "symbol": symbol}

                proposal    = prop_resp.get("proposal", {})
                proposal_id = proposal.get("id")
                ask_price   = proposal.get("ask_price")

                if not proposal_id:
                    return {"ok": False, "error": "No proposal ID returned by Deriv",
                            "contract_type": contract_type, "symbol": symbol}

                buy_resp = await ws_send_recv(ws, {"buy": proposal_id, "price": ask_price}, timeout=20.0)
                if buy_resp.get("error"):
                    err_msg = buy_resp["error"].get("message", str(buy_resp["error"]))
                    return {"ok": False, "error": f"Buy failed: {err_msg}",
                            "contract_type": contract_type, "symbol": symbol}

                buy = buy_resp.get("buy", {})
                return {
                    "ok":            True,
                    "contract_id":   buy.get("contract_id"),
                    "contract_type": contract_type,
                    "symbol":        symbol,
                    "multiplier":    multiplier,
                    "ask_price":     ask_price,
                    "balance_after": buy.get("balance_after"),
                }

        except (websockets.exceptions.ConnectionClosed,
                websockets.exceptions.WebSocketException) as e:
            last_error = f"WS error (attempt {attempt+1}/3): {e}"
            print(f"[TRADE WS]  {symbol} {last_error}")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
        except asyncio.TimeoutError:
            last_error = f"Timeout (attempt {attempt+1}/3)"
            print(f"[TRADE WS]  {symbol} {last_error}")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
        except Exception as e:
            return {"ok": False, "error": str(e), "contract_type": contract_type, "symbol": symbol}

    return {"ok": False, "error": last_error, "contract_type": contract_type, "symbol": symbol}


async def _trigger_trade_if_confirmed(sym: Dict) -> None:
    """Strategy: DPO(250) + Stochastic RSI(150,120,55,9) + MACD(36,80,36) + Aroon(350)

      BUY  (MULTUP):   DPO > 0   AND StochRSI %K,%D <= 20  AND MACD crossed
                        from a bearish bar (prev candle) to a bullish bar
                        (current candle) — i.e. MACD line crossed above signal
                        AND Aroon confirms: Aroon Up > 70 AND Aroon Down < 20
      SELL (MULTDOWN): DPO < 0   AND StochRSI %K,%D >= 80  AND MACD crossed
                        from a bullish bar (prev candle) to a bearish bar
                        (current candle) — i.e. MACD line crossed below signal
                        AND Aroon confirms: Aroon Down > 70 AND Aroon Up < 20
    """
    global _trade_log, _traded_candle_epoch

    symbol = sym["symbol"]
    signal = sym.get("signal", "NONE")
    if signal not in ("BUY", "SELL"):
        return

    # One trade per symbol per candle: only act the first time a given candle
    # (identified by its epoch) produces this signal. This is what stops the
    # bot from re-firing on every scan while the same latest candle is still
    # the current one — no time-based cooldown lookback needed.
    candle_epoch = sym.get("candle_epoch")
    if candle_epoch is None or _traded_candle_epoch.get(symbol) == candle_epoch:
        return

    contract_type = "MULTUP" if signal == "BUY" else "MULTDOWN"
    stoch_rsi     = sym.get("stoch_rsi") or {}
    macd          = sym.get("macd") or {}
    dpo           = sym.get("dpo") or {}
    signal_label  = (
        f"DPO={dpo.get('value')} StochK={stoch_rsi.get('k')} "
        f"StochD={stoch_rsi.get('d')} MACD={macd.get('macd')} Sig={macd.get('signal')}"
    )

    _traded_candle_epoch[symbol] = candle_epoch
    result = await _place_multiplier_trade(symbol, contract_type)

    entry = {
        "timestamp":     datetime.utcnow().isoformat(),
        "symbol":        symbol,
        "direction":     signal,
        "contract_type": contract_type,
        "strategy":      "StochRSI+MACD+DPO",
        "signal":        signal_label,
        "dpo":           dpo.get("value"),
        "stoch_k":       stoch_rsi.get("k"),
        "stoch_d":       stoch_rsi.get("d"),
        "macd":          macd.get("macd"),
        "macd_signal":   macd.get("signal"),
        "contract_id":   result.get("contract_id"),
        "ok":            result.get("ok", False),
        "error":         result.get("error"),
    }
    _trade_log.insert(0, entry)
    if len(_trade_log) > 50:
        _trade_log = _trade_log[:50]

    status = f"✅ {result.get('contract_id')}" if result.get("ok") else f"❌ {result.get('error')}"
    print(f"[TRADE] {symbol} {signal} | {signal_label} | {status}")


# ──────────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────────

app = FastAPI(title="Deriv Step Index Bot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
router = APIRouter(prefix="/api")


@router.get("/healthz")
async def health():
    return {"status": "ok"}


@router.get("/market/symbols")
async def get_symbols():
    return [
        {"symbol": s, "name": c["name"], "multiplier": c["multiplier"]}
        for s, c in SYMBOL_CONFIG.items()
    ]


@router.get("/market/analysis")
async def market_analysis():
    global _analysis_cache, _analysis_cache_time
    now = time.time()
    if _analysis_cache and (now - _analysis_cache_time) < CACHE_TTL:
        return _analysis_cache
    try:
        data = await run_full_analysis()
        _analysis_cache      = data
        _analysis_cache_time = now
        return data
    except Exception as e:
        if _analysis_cache:
            return _analysis_cache
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/market/chart/{symbol}")
async def get_chart(symbol: str):
    if symbol not in SYMBOL_CONFIG:
        raise HTTPException(status_code=404, detail="Symbol not found")
    now = time.time()
    if symbol in _chart_cache and (now - _chart_cache_time.get(symbol, 0)) < CACHE_TTL:
        return _chart_cache[symbol]
    try:
        data = await build_chart_data(symbol)
        _chart_cache[symbol]      = data
        _chart_cache_time[symbol] = now
        return data
    except Exception as e:
        if symbol in _chart_cache:
            return _chart_cache[symbol]
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trading/status")
async def trading_status():
    """`cooldowns` here means "seconds left until the current candle closes"
    for symbols that have already been traded on their latest candle — once
    a new candle opens the symbol is free to trade again on a fresh signal."""
    now = time.time()
    locked: Dict[str, int] = {}
    cache = _analysis_cache or {}
    for r in cache.get("symbols", []):
        s     = r.get("symbol")
        epoch = r.get("candle_epoch")
        if epoch is not None and _traded_candle_epoch.get(s) == epoch:
            remaining = 60 - int(now - epoch)
            if remaining > 0:
                locked[s] = remaining
    return {"trades": _trade_log, "cooldowns": locked}


@router.get("/trading/config")
async def trading_config():
    return {
        "trading_enabled":      bool(TOKEN and APP_ID),
        "auto_trading_enabled": AUTO_TRADING_ENABLED,
        "trade_on_demo_only":   TRADE_ON_DEMO_ONLY,
        "stake":                TRADE_STAKE,
        "stop_loss":            TRADE_STOP_LOSS,
        "take_profit":          TRADE_TAKE_PROFIT,
        "cooldown_secs":        60,
    }


app.include_router(router)

# ── Production: serve built frontend ──────────────────────────
_FRONTEND = Path(__file__).parent.parent / "dashboard" / "dist" / "public"

if _FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return FileResponse(str(_FRONTEND / "index.html"))


@app.on_event("startup")
async def start_background_scanner():
    async def _loop():
        print(f"[SCANNER] Started — Strategy: DPO({DPO_PERIOD}) + StochRSI({RSI_LENGTH},{STOCH_LENGTH},{STOCH_SMOOTH_K},{STOCH_SMOOTH_D}) + MACD({MACD_FAST},{MACD_SLOW},{MACD_SIGNAL}) + Aroon({AROON_PERIOD}) | Auto-trading: {AUTO_TRADING_ENABLED}")
        while True:
            tick_start = time.time()
            try:
                data = await run_full_analysis()
                global _analysis_cache, _analysis_cache_time
                _analysis_cache      = data
                _analysis_cache_time = time.time()
                elapsed = time.time() - tick_start
                print(f"[SCANNER] Scan complete — {len(data.get('symbols', []))} symbols | "
                      f"{data.get('buy_count', 0)} buy / {data.get('sell_count', 0)} sell signal(s) | {elapsed:.1f}s")
            except Exception as e:
                print(f"[SCANNER] Error during scan: {e}")
            elapsed = time.time() - tick_start
            await asyncio.sleep(max(0, 60 - elapsed))
    asyncio.create_task(_loop())


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
