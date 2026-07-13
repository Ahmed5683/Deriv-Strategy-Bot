---
name: Deriv trading strategy spec
description: Step Index symbols/multipliers, indicator periods, and the BUY/SELL entry rule for the Deriv trading bot. Read before touching artifacts/api-server/server.py strategy logic.
---

## Symbols (replaced Boom/Crash entirely)

| Symbol   | Multiplier |
|----------|-----------|
| stpRNG   | 750       |
| stpRNG2  | 400       |
| stpRNG3  | 300       |
| stpRNG4  | 200       |
| stpRNG5  | 100       |

Each symbol trades independently (no shared direction lock like the old Boom/Crash pairing).

## Indicators (old EMA/Aroon/ADX fully removed)

- **Stochastic RSI**: RSI length 150 → Stochastic length 120 → smooth %K 55 → smooth %D 9. Oversold = %K and %D both <= 20. Overbought = both >= 80.
- **MACD**: fast EMA 21, slow EMA 55, signal EMA 36.
- **DPO**: period 250 (shift = period//2 + 1 = 126 bars back).

**Why these specific numbers:** user-specified, not derived — do not "round" or "simplify" them if revisiting this code.

## Entry rule

- **BUY (MULTUP)**: DPO > 0 AND StochRSI oversold (%K & %D <= 20) AND MACD line just turned upward (troughed) while still **below** its signal line — i.e. an early/pre-crossover bullish turn, not a full crossover.
- **SELL (MULTDOWN)**: symmetric mirror — DPO < 0 AND StochRSI overbought (%K & %D >= 80) AND MACD line just turned downward (peaked) while still **above** its signal line.

**Why "still below/above signal" instead of a full crossover:** the user explicitly wants the *early* turn signal, before MACD crosses its signal line — confirmed via clarifying question during initial build (2026-07-13). If this ever needs revisiting, re-confirm with the user rather than assuming a standard MACD crossover is equivalent.

## Risk settings (same across all 5 symbols)

Stake $1, stop loss $1, take profit $1.2, 300s cooldown per symbol. Auto-trading defaults to **demo account only**.

## Bar warm-up requirement

StochRSI needs the most history: RSI_LENGTH + STOCH_LENGTH + STOCH_SMOOTH_K + STOCH_SMOOTH_D + buffer (~355 bars minimum). The analysis window is sized to the max of all three indicators' warm-up needs, not just DPO's.
