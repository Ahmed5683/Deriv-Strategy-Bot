import { useParams, Link } from 'wouter';
import { useChart } from '../lib/api';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useRef, useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function CandlestickSvg({ data }: { data: any[] }) {
  const { ref, width, height } = useContainerSize();
  
  const content = useMemo(() => {
    if (!data || data.length === 0 || width === 0 || height === 0) return null;
    
    const padding = { top: 10, bottom: 20, left: 0, right: 50 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    
    const minPrice = Math.min(...data.map(d => d.low));
    const maxPrice = Math.max(...data.map(d => d.high));
    const priceRange = maxPrice - minPrice || 1;
    
    const paddedMin = minPrice - priceRange * 0.05;
    const paddedMax = maxPrice + priceRange * 0.05;
    const paddedRange = paddedMax - paddedMin;
    
    const candleWidth = Math.max(2, (innerWidth / data.length) * 0.7);
    const stepX = innerWidth / Math.max(1, data.length);
    
    const scaleY = (val: number) => innerHeight - ((val - paddedMin) / paddedRange) * innerHeight + padding.top;
    const scaleX = (idx: number) => padding.left + idx * stepX + stepX / 2;
    
    return (
      <svg width={width} height={height} className="overflow-visible font-mono text-[10px]">
        {/* Grid lines */}
        <line x1={0} x2={width - padding.right} y1={padding.top} y2={padding.top} stroke="currentColor" className="text-border" strokeDasharray="4 4" />
        <line x1={0} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="currentColor" className="text-border" strokeDasharray="4 4" />
        <line x1={0} x2={width - padding.right} y1={padding.top + innerHeight/2} y2={padding.top + innerHeight/2} stroke="currentColor" className="text-border" strokeDasharray="4 4" />
        
        {/* Y Axis */}
        <text x={width - padding.right + 10} y={padding.top + 4} fill="currentColor" className="text-muted-foreground">{paddedMax.toFixed(2)}</text>
        <text x={width - padding.right + 10} y={height - padding.bottom + 4} fill="currentColor" className="text-muted-foreground">{paddedMin.toFixed(2)}</text>
        <text x={width - padding.right + 10} y={padding.top + innerHeight/2 + 4} fill="currentColor" className="text-muted-foreground">{((paddedMax + paddedMin)/2).toFixed(2)}</text>
        
        {data.map((d, i) => {
          const x = scaleX(i);
          const yHigh = scaleY(d.high);
          const yLow = scaleY(d.low);
          const yOpen = scaleY(d.open);
          const yClose = scaleY(d.close);
          
          const isBullish = d.close >= d.open;
          const colorClass = isBullish ? 'text-bullish' : 'text-bearish';
          
          const yTop = Math.min(yOpen, yClose);
          const yBot = Math.max(yOpen, yClose);
          const bodyHeight = Math.max(1, yBot - yTop);
          
          return (
            <g key={d.time} className={colorClass}>
              <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke="currentColor" strokeWidth={1} />
              <rect x={x - candleWidth/2} y={yTop} width={candleWidth} height={bodyHeight} fill="currentColor" />
            </g>
          );
        })}
      </svg>
    );
  }, [data, width, height]);

  return <div ref={ref} className="w-full h-full">{content}</div>;
}

export function SymbolView() {
  const { symbol } = useParams();
  const { data: chart, isLoading } = useChart(symbol || '');

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!chart) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Chart data not available</div>;
  }

  const n = chart.candles.length;
  const aroonUp   = chart.aroon?.up_values   ?? [];
  const aroonDown = chart.aroon?.down_values  ?? [];
  // aroon series is shorter than candles (needs period warm-up) — align to tail
  const aroonOffset = n - aroonUp.length;

  const indicatorData = chart.candles.map((candle, i) => ({
    time:       format(new Date(candle.time * 1000), 'HH:mm'),
    k:          chart.stoch_rsi?.k_values?.[i] ?? null,
    d:          chart.stoch_rsi?.d_values?.[i] ?? null,
    macd:       chart.macd?.macd_values?.[i]   ?? null,
    signal:     chart.macd?.signal_values?.[i] ?? null,
    dpo:        chart.dpo?.values?.[i]         ?? null,
    aroon_up:   i >= aroonOffset ? (aroonUp[i - aroonOffset]   ?? null) : null,
    aroon_down: i >= aroonOffset ? (aroonDown[i - aroonOffset] ?? null) : null,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="h-14 border-b border-border flex items-center px-4 shrink-0 bg-card">
        <Link href="/" className="mr-4 p-2 -ml-2 rounded-md hover:bg-muted/50 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="font-bold text-lg leading-none">{chart.symbol}</h2>
          <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">{chart.bar_count} bars loaded</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* PRICE CHART */}
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col h-[400px]">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Price Action</h3>
          <div className="flex-1 -mx-2">
            <CandlestickSvg data={chart.candles} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[auto] lg:h-[300px]">
          {/* STOCH RSI */}
          <div className="bg-card border border-border rounded-lg p-4 flex flex-col h-[250px] lg:h-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">StochRSI (150,120,55,9)</h3>
              <div className="text-[10px] font-mono flex gap-3">
                <span className="text-primary">%K {chart.stoch_rsi.k?.toFixed(2)}</span>
                <span className="text-orange-400">%D {chart.stoch_rsi.d?.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indicatorData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} hide />
                  <ReferenceLine y={80} stroke="hsl(var(--bearish))" strokeDasharray="4 4" opacity={0.5} />
                  <ReferenceLine y={20} stroke="hsl(var(--bullish))" strokeDasharray="4 4" opacity={0.5} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} itemStyle={{ fontFamily: 'monospace' }} />
                  <Line type="monotone" dataKey="k" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="d" stroke="#f6ad55" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* MACD */}
          <div className="bg-card border border-border rounded-lg p-4 flex flex-col h-[250px] lg:h-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">MACD (21,55,36)</h3>
              <div className="text-[10px] font-mono flex gap-3">
                <span className="text-primary">MACD {chart.macd.macd?.toFixed(3)}</span>
                <span className="text-orange-400">SIG {chart.macd.signal?.toFixed(3)}</span>
              </div>
            </div>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indicatorData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" opacity={0.3} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} itemStyle={{ fontFamily: 'monospace' }} />
                  <Line type="monotone" dataKey="macd" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="signal" stroke="#f6ad55" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* DPO */}
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col h-[250px] lg:h-[200px]">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Detrended Price Oscillator</h3>
            <div className="text-[10px] font-mono flex gap-3">
              <span className={chart.dpo.value && chart.dpo.value > 0 ? 'text-bullish' : 'text-bearish'}>
                DPO {chart.dpo.value?.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={indicatorData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} itemStyle={{ fontFamily: 'monospace' }} />
                <Line type="monotone" dataKey="dpo" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AROON */}
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col h-[250px] lg:h-[200px]">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Aroon (250)</h3>
            <div className="text-[10px] font-mono flex gap-3">
              <span className="text-bullish">Up {chart.aroon?.up?.toFixed(2) ?? '—'}</span>
              <span className="text-bearish">Down {chart.aroon?.down?.toFixed(2) ?? '—'}</span>
              {chart.aroon?.buy_confirmed && (
                <span className="text-bullish font-bold">▲ BUY CONFIRMED</span>
              )}
              {chart.aroon?.sell_confirmed && (
                <span className="text-bearish font-bold">▼ SELL CONFIRMED</span>
              )}
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={indicatorData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis domain={[0, 100]} hide />
                <ReferenceLine y={70} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
                <ReferenceLine y={20} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  itemStyle={{ fontFamily: 'monospace' }}
                  formatter={(v: any, name: string) => [
                    typeof v === 'number' ? v.toFixed(2) : v,
                    name === 'aroon_up' ? 'Aroon Up' : 'Aroon Down'
                  ]}
                />
                <Line type="monotone" dataKey="aroon_up"   stroke="hsl(var(--bullish))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="aroon_down" stroke="hsl(var(--bearish))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
