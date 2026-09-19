import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  componentName?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    try {
      window.localStorage.setItem('sita_active_tab_v1', 'dashboard');
    } catch (e) {}
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  private handleClearCacheAndReset = () => {
    if (window.confirm('Bersihkan data cache lokal dan muat ulang sistem? Data yang belum tersinkronisasi mungkin perlu dikirim ulang.')) {
      try {
        const preserveKeys = ['sita_supabase_url', 'sita_supabase_anon_key'];
        const preserved: Record<string, string> = {};
        preserveKeys.forEach(k => {
          const val = window.localStorage.getItem(k);
          if (val) preserved[k] = val;
        });

        window.localStorage.clear();

        Object.entries(preserved).forEach(([k, v]) => {
          window.localStorage.setItem(k, v);
        });
      } catch (e) {
        console.warn('Could not clear localStorage:', e);
      }
      window.location.href = window.location.pathname;
    }
  };

  public render() {
    if (this.state.hasError) {
      const isSubComponent = Boolean(this.props.componentName);
      const isQuotaError = this.state.error?.name === 'QuotaExceededError' || 
                           this.state.error?.message?.toLowerCase().includes('quota') ||
                           this.state.error?.message?.toLowerCase().includes('storage');

      return (
        <div className={`flex flex-col items-center justify-center p-4 sm:p-6 ${isSubComponent ? 'min-h-[350px] w-full' : 'min-h-screen bg-slate-50 font-sans'}`}>
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200/80 animate-fade-in text-center relative overflow-hidden">
            {/* Top Accent Line */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-600" />
            
            <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/60 flex items-center justify-center mx-auto mb-4 shadow-sm">
              <AlertTriangle size={32} />
            </div>

            <h2 className="text-lg sm:text-xl font-extrabold text-slate-800 tracking-tight">
              {isSubComponent ? `Kendala pada ${this.props.componentName}` : 'Terjadi Kendala Tampilan Sistem'}
            </h2>

            <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
              {isQuotaError 
                ? 'Penyimpanan cache browser di HP Anda telah mencapai batas maksimal (penuh). Silakan gunakan tombol bersihkan cache di bawah.' 
                : 'Aplikasi mengalami kendala saat memproses data tampilan di perangkat ini. Anda dapat memuat ulang atau membersihkan cache agar sistem normal kembali.'}
            </p>

            {/* Tombol Aksi Utama */}
            <div className="flex flex-col sm:flex-row gap-2.5 mt-6 w-full">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-md shadow-emerald-600/15 flex items-center justify-center gap-2 active:scale-95"
              >
                <RefreshCw size={15} /> Muat Ulang Halaman
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl text-xs transition-all border border-slate-200 flex items-center justify-center gap-2 active:scale-95"
              >
                <Home size={15} /> Ke Dashboard
              </button>
            </div>

            {/* Tombol Pemulihan Memori / Cache */}
            <div className="mt-3">
              <button
                type="button"
                onClick={this.handleClearCacheAndReset}
                className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2.5 px-4 rounded-xl text-xs transition-all border border-rose-200 flex items-center justify-center gap-2"
              >
                <Trash2 size={14} /> Bersihkan Cache Lokal & Masuk Ulang
              </button>
            </div>

            {/* Accordion Detail Teknis Error (Dapat Dilipat) */}
            <div className="mt-5 pt-4 border-t border-slate-100 text-left">
              <button
                type="button"
                onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              >
                <span>Lihat Informasi Teknis Error</span>
                {this.state.showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {this.state.showDetails && (
                <div className="mt-2.5 bg-slate-900 text-slate-200 p-3 rounded-xl text-[10px] font-mono overflow-x-auto max-h-48 leading-relaxed">
                  <div className="text-rose-400 font-bold mb-1">
                    {this.state.error?.name || 'Error'}: {this.state.error?.message || 'Unknown error'}
                  </div>
                  {this.state.error?.stack && (
                    <pre className="whitespace-pre-wrap text-slate-400 text-[9px] mt-1">
                      {this.state.error.stack}
                    </pre>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <pre className="whitespace-pre-wrap text-slate-500 text-[9px] mt-1 border-t border-slate-800 pt-1">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
