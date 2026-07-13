import { useQuery } from '@tanstack/react-query';

export interface SymbolData {
  symbol: string;
  name: string;
  multiplier: number;
}

export interface StochRSI {
  k: number | null;
  d: number | null;
  oversold: boolean;
  overbought: boolean;
  k_values: number[];
  d_values: number[];
}

export interface MACD {
  macd: number | null;
  signal: number | null;
  bullish_turn: boolean;
  bearish_turn: boolean;
  macd_values: number[];
  signal_values: number[];
}

export interface DPO {
  value: number | null;
  positive: boolean;
  negative: boolean;
  values: number[];
}

export interface AnalyzedSymbol {
  symbol: string;
  name: string;
  multiplier: number;
  price: number;
  stoch_rsi: StochRSI;
  macd: MACD;
  dpo: DPO;
  signal: 'BUY' | 'SELL' | 'NONE';
  last_updated: string;
}

export interface MarketAnalysis {
  timestamp: string;
  buy_count: number;
  sell_count: number;
  symbols: AnalyzedSymbol[];
}

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartData {
  symbol: string;
  candles: ChartCandle[];
  stoch_rsi: StochRSI;
  macd: MACD;
  dpo: DPO;
  bar_count: number;
  last_updated: string;
}

export interface Trade {
  timestamp: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  contract_type: 'MULTUP' | 'MULTDOWN';
  strategy: string;
  signal: string;
  dpo: number;
  stoch_k: number;
  stoch_d: number;
  macd: number;
  macd_signal: number;
  contract_id: string | number | null;
  ok: boolean;
  error: string | null;
}

export interface TradingStatus {
  trades: Trade[];
  cooldowns: Record<string, number>;
}

export interface TradingConfig {
  trading_enabled: boolean;
  auto_trading_enabled: boolean;
  trade_on_demo_only: boolean;
  stake: number;
  stop_loss: number;
  take_profit: number;
  cooldown_secs: number;
}

const fetcher = async <T>(path: string): Promise<T> => {
  const url = `${import.meta.env.BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
};

export const useSymbols = () =>
  useQuery<SymbolData[]>({
    queryKey: ['symbols'],
    queryFn: () => fetcher('api/market/symbols'),
  });

export const useMarketAnalysis = () =>
  useQuery<MarketAnalysis>({
    queryKey: ['market-analysis'],
    queryFn: () => fetcher('api/market/analysis'),
    refetchInterval: 25000,
  });

export const useChart = (symbol: string) =>
  useQuery<ChartData>({
    queryKey: ['chart', symbol],
    queryFn: () => fetcher(`api/market/chart/${symbol}`),
    refetchInterval: 30000,
    enabled: !!symbol,
  });

export const useTradingStatus = () =>
  useQuery<TradingStatus>({
    queryKey: ['trading-status'],
    queryFn: () => fetcher('api/trading/status'),
    refetchInterval: 12000,
  });

export const useTradingConfig = () =>
  useQuery<TradingConfig>({
    queryKey: ['trading-config'],
    queryFn: () => fetcher('api/trading/config'),
    refetchInterval: 60000,
  });
