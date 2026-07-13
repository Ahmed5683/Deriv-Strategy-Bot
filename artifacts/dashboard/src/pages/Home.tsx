import { useMarketAnalysis, useTradingStatus } from '../lib/api';
import { Link } from 'wouter';
import { ArrowUpRight, ArrowDownRight, Minus, Clock, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';

const SignalBadge = ({ signal }: { signal: 'BUY' | 'SELL' | 'NONE' }) => {
  if (signal === 'BUY') {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bullish/10 text-bullish border border-bullish/20 animate-pulse-bullish">
        <ArrowUpRight className="w-3.5 h-3.5" />
        <span className="text-xs font-bold tracking-wider">BUY</span>
      </div>
    );
  }
  if (signal === 'SELL') {
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bearish/10 text-bearish border border-bearish/20 animate-pulse-bearish">
        <ArrowDownRight className="w-3.5 h-3.5" />
        <span className="text-xs font-bold tracking-wider">SELL</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border">
      <Minus className="w-3.5 h-3.5" />
      <span className="text-xs font-bold tracking-wider">NONE</span>
    </div>
  );
};

const ValueTransition = ({ value, className = '' }: { value: number | null, className?: string }) => {
  const [prev, setPrev] = useState(value);
  const [color, setColor] = useState('text-foreground');

  useEffect(() => {
    if (value !== null && prev !== null && value !== prev) {
      setColor(value > prev ? 'text-bullish' : 'text-bearish');
      const timer = setTimeout(() => setColor('text-foreground'), 1000);
      setPrev(value);
      return () => clearTimeout(timer);
    } else if (value !== null && prev === null) {
      setPrev(value);
    }
    return undefined;
  }, [value, prev]);

  return (
    <span className={`transition-colors duration-300 font-mono ${color} ${className}`}>
      {value !== null ? value.toFixed(4) : '--'}
    </span>
  );
};

export function Home() {
  const { data: analysis, isLoading: analysisLoading } = useMarketAnalysis();
  const { data: status, isLoading: statusLoading } = useTradingStatus();

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold tracking-tight">Market Overview</h2>
          {analysis && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Updated </span>
              {formatDistanceToNow(parseISO(analysis.timestamp), { addSuffix: true })}
            </div>
          )}
        </div>

        {analysisLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-44 bg-card rounded-lg border border-border animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {analysis?.symbols.map((symbol, idx) => (
              <Link key={symbol.symbol} href={`/symbol/${symbol.symbol}`} className="block group">
                <div 
                  className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all hover:-translate-y-0.5 relative overflow-hidden flex flex-col h-full shadow-sm"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  {symbol.signal !== 'NONE' && (
                    <div className={`absolute top-0 left-0 w-1 h-full ${symbol.signal === 'BUY' ? 'bg-bullish' : 'bg-bearish'}`} />
                  )}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg">{symbol.name}</h3>
                      <div className="text-xs text-muted-foreground font-mono opacity-80">x{symbol.multiplier}</div>
                    </div>
                    <SignalBadge signal={symbol.signal} />
                  </div>
                  
                  <div className="mb-6 mt-2">
                    <div className="text-3xl font-mono tracking-tight font-medium">
                      <ValueTransition value={symbol.price} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-auto pt-4 border-t border-border/50 text-xs">
                    <div>
                      <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">StochRSI</div>
                      <div className="font-mono">
                        <span className={symbol.stoch_rsi.oversold ? 'text-bullish' : symbol.stoch_rsi.overbought ? 'text-bearish' : 'text-foreground'}>
                          {symbol.stoch_rsi.k?.toFixed(1) ?? '--'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">MACD</div>
                      <div className="font-mono">
                        <span className={symbol.macd.bullish_turn ? 'text-bullish' : symbol.macd.bearish_turn ? 'text-bearish' : 'text-foreground'}>
                          {symbol.macd.macd?.toFixed(3) ?? '--'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wider">DPO</div>
                      <div className="font-mono">
                        <span className={symbol.dpo.positive ? 'text-bullish' : symbol.dpo.negative ? 'text-bearish' : 'text-foreground'}>
                          {symbol.dpo.value?.toFixed(2) ?? '--'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-card flex flex-col shrink-0 h-64 md:h-auto">
        <div className="h-12 md:h-14 border-b border-border flex items-center px-4 shrink-0 bg-background/30 backdrop-blur">
          <Zap className="w-4 h-4 text-primary mr-2" />
          <h3 className="font-semibold text-sm">Trade Feed</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {statusLoading ? (
             <div className="space-y-3">
               {[1,2,3].map(i => <div key={i} className="h-20 bg-muted/20 rounded animate-pulse" />)}
             </div>
          ) : status?.trades.length === 0 ? (
             <div className="text-center text-muted-foreground text-sm mt-10">No recent trades</div>
          ) : (
            status?.trades.map((trade, idx) => (
              <div key={`${trade.timestamp}-${idx}`} className="bg-background border border-border rounded p-3 text-xs relative overflow-hidden group hover:border-primary/30 transition-colors">
                <div className={`absolute top-0 left-0 w-1 h-full ${trade.direction === 'BUY' ? 'bg-bullish' : 'bg-bearish'}`} />
                <div className="flex justify-between items-start mb-2 pl-2">
                  <span className="font-bold">{trade.symbol}</span>
                  <span className="text-muted-foreground opacity-70">
                    {formatDistanceToNow(parseISO(trade.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2 pl-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ${trade.direction === 'BUY' ? 'bg-bullish/10 text-bullish' : 'bg-bearish/10 text-bearish'}`}>
                    {trade.contract_type}
                  </span>
                  <span className="text-muted-foreground truncate">{trade.strategy}</span>
                </div>
                {trade.ok ? (
                  <div className="flex items-center gap-1.5 text-bullish pl-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate flex-1" title={trade.signal}>{trade.signal}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-destructive pl-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate flex-1" title={trade.error || 'Failed'}>{trade.error || 'Failed'}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
