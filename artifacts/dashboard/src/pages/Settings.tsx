import { useTradingConfig } from '../lib/api';
import { ShieldAlert, Server, Cpu, Activity, Clock, Crosshair, DollarSign } from 'lucide-react';

export function Settings() {
  const { data: config, isLoading } = useTradingConfig();

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto w-full space-y-6">
        <div className="h-10 w-64 bg-card rounded animate-pulse" />
        <div className="h-48 bg-card rounded-xl border border-border animate-pulse" />
        <div className="h-64 bg-card rounded-xl border border-border animate-pulse" />
      </div>
    );
  }

  if (!config) {
    return <div className="p-8 text-muted-foreground text-center mt-10">Failed to load configuration.</div>;
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto w-full overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Trading Engine Config</h1>
        <p className="text-muted-foreground">Read-only view of the currently deployed bot parameters.</p>
      </div>

      <div className="grid gap-6">
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-border bg-background/50 flex items-center gap-3">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-lg">System Status</h2>
          </div>
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border">
              <div className="flex items-center gap-3">
                <Cpu className="w-5 h-5 text-muted-foreground" />
                <span className="font-medium">Trading Engine</span>
              </div>
              <div className={`px-2.5 py-1 rounded text-xs font-bold tracking-wider ${config.trading_enabled ? 'bg-bullish/10 text-bullish' : 'bg-bearish/10 text-bearish'}`}>
                {config.trading_enabled ? 'ONLINE' : 'OFFLINE'}
              </div>
            </div>
            
            <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-muted-foreground" />
                <span className="font-medium">Auto-Trading</span>
              </div>
              <div className={`px-2.5 py-1 rounded text-xs font-bold tracking-wider ${config.auto_trading_enabled ? 'bg-primary/10 text-primary animate-pulse-bullish' : 'bg-muted text-muted-foreground'}`}>
                {config.auto_trading_enabled ? 'ACTIVE' : 'PAUSED'}
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border sm:col-span-2">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-muted-foreground" />
                <span className="font-medium">Environment Guard</span>
              </div>
              <div className={`px-3 py-1 rounded border text-xs font-bold tracking-wider ${config.trade_on_demo_only ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-destructive/10 text-destructive border-destructive/20 animate-pulse-bearish'}`}>
                {config.trade_on_demo_only ? 'DEMO ACCOUNT ONLY' : 'LIVE TRADING ENABLED'}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-border bg-background/50 flex items-center gap-3">
            <Crosshair className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-lg">Risk Parameters</h2>
          </div>
          <div className="p-0 divide-y divide-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-background/50 transition-colors gap-4">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium">Base Stake</div>
                  <div className="text-xs text-muted-foreground">Amount per trade in USD</div>
                </div>
              </div>
              <div className="text-xl font-mono font-semibold">${config.stake.toFixed(2)}</div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-background/50 transition-colors gap-4">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 flex items-center justify-center text-muted-foreground font-bold shrink-0">SL</div>
                <div>
                  <div className="font-medium">Stop Loss</div>
                  <div className="text-xs text-muted-foreground">Maximum loss per trade</div>
                </div>
              </div>
              <div className="text-xl font-mono font-semibold text-bearish">-${config.stop_loss.toFixed(2)}</div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-background/50 transition-colors gap-4">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 flex items-center justify-center text-muted-foreground font-bold shrink-0">TP</div>
                <div>
                  <div className="font-medium">Take Profit</div>
                  <div className="text-xs text-muted-foreground">Target profit per trade</div>
                </div>
              </div>
              <div className="text-xl font-mono font-semibold text-bullish">+${config.take_profit.toFixed(2)}</div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-background/50 transition-colors gap-4">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium">Global Cooldown</div>
                  <div className="text-xs text-muted-foreground">Wait time between trades per symbol</div>
                </div>
              </div>
              <div className="text-xl font-mono font-semibold">{config.cooldown_secs}s</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
