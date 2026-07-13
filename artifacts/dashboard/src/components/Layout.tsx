import { Link, useLocation } from 'wouter';
import { useTradingConfig } from '../lib/api';
import { Activity } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: config } = useTradingConfig();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans">
      <header className="h-14 border-b border-border flex items-center px-4 md:px-6 justify-between bg-card z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Activity className="w-5 h-5 text-primary" />
            <span className="font-bold tracking-tight text-lg">STEP<span className="text-muted-foreground">BOT</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
            <Link href="/" className={`px-2 py-1 rounded-md transition-colors ${location === '/' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              Overview
            </Link>
            <Link href="/settings" className={`px-2 py-1 rounded-md transition-colors ${location === '/settings' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {config ? (
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-background/50">
                <div className={`w-2 h-2 rounded-full ${config.auto_trading_enabled ? 'bg-bullish animate-pulse-bullish' : 'bg-muted-foreground'}`} />
                <span className="text-muted-foreground font-mono hidden sm:inline">AUTO: {config.auto_trading_enabled ? 'ON' : 'OFF'}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-background/50">
                <span className={`font-mono font-bold ${config.trade_on_demo_only ? 'text-yellow-500' : 'text-destructive'}`}>
                  {config.trade_on_demo_only ? 'DEMO' : 'LIVE'}
                </span>
              </div>
              <Link href="/settings" className="md:hidden p-1.5 rounded bg-background/50 border border-border text-muted-foreground hover:text-foreground">
                Config
              </Link>
            </div>
          ) : (
            <div className="h-6 w-32 bg-muted/20 animate-pulse rounded" />
          )}
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </div>
  );
}
