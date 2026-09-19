import React, { useState } from 'react';
import { ZoomIn, ZoomOut, Sun, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react';

interface MushafPageProps {
  pageNumber: number;
  juzNumber?: number;
}

export const MushafPage: React.FC<MushafPageProps> = ({ pageNumber, juzNumber }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [brightness, setBrightness] = useState(100);

  const paddedPage = pageNumber.toString().padStart(3, '0');
  const imageUrl = `https://android.quran.com/data/width_1024/page${paddedPage}.png`;

  const handleRetry = () => {
    setHasError(false);
    setIsLoading(true);
    setRetryCount(prev => prev + 1);
  };

  const handleResetView = () => {
    setZoomLevel(1);
    setBrightness(100);
  };

  return (
    <div className="flex flex-col items-center w-full select-none">
      {/* Visual Controls Bar */}
      <div className="w-full max-w-2xl flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-gray-100 shadow-sm mb-3 text-xs text-gray-600">
        <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
          <span className="bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100 font-mono">
            Hal. {pageNumber}
          </span>
          {juzNumber && (
            <span className="bg-teal-50 text-teal-800 px-2.5 py-1 rounded-md border border-teal-100">
              Juz {juzNumber}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setZoomLevel(z => Math.max(0.7, Math.round((z - 0.15) * 100) / 100))}
              className="p-1 hover:bg-white rounded transition-colors text-gray-500 hover:text-gray-800"
              title="Perkecil Halaman"
            >
              <ZoomOut size={15} />
            </button>
            <span className="font-mono text-[11px] px-1 w-10 text-center font-bold text-gray-600">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel(z => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))}
              className="p-1 hover:bg-white rounded transition-colors text-gray-500 hover:text-gray-800"
              title="Perbesar Halaman"
            >
              <ZoomIn size={15} />
            </button>
          </div>

          {/* Brightness slider */}
          <div className="hidden sm:flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">
            <Sun size={14} className="text-gray-400" />
            <input
              type="range"
              min="75"
              max="135"
              value={brightness}
              onChange={(e) => setBrightness(parseInt(e.target.value, 10))}
              className="w-16 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              title="Kecerahan Halaman"
            />
          </div>

          {/* Reset button */}
          {(zoomLevel !== 1 || brightness !== 100) && (
            <button
              type="button"
              onClick={handleResetView}
              className="p-1.5 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Reset Tampilan"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Main Mushaf Page Frame */}
      <div className="relative w-full max-w-2xl bg-amber-50/40 rounded-2xl p-2 sm:p-4 md:p-6 border border-amber-200/60 shadow-md flex justify-center items-center overflow-auto min-h-[480px]">
        {/* Loading Spinner */}
        {isLoading && !hasError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm rounded-2xl gap-3">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-semibold text-emerald-800">Memuat Halaman Mushaf...</p>
          </div>
        )}

        {/* Error Fallback */}
        {hasError ? (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 bg-white/90 rounded-xl border border-red-100 shadow-sm max-w-md">
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
            <h4 className="font-bold text-sm text-gray-800">Halaman Mushaf Gagal Dimuat</h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              Koneksi ke server gambar mushaf mengalami kendala. Silakan periksa koneksi internet Anda lalu coba kembali.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-emerald-600/20"
            >
              <RefreshCw size={14} />
              <span>Coba Lagi</span>
            </button>
          </div>
        ) : (
          <div 
            style={{ 
              width: `${zoomLevel * 100}%`, 
              maxWidth: 'none', 
              transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)' 
            }} 
            className="flex justify-center"
          >
            <img
              key={`${pageNumber}-${retryCount}`}
              src={imageUrl}
              alt={`Mushaf Madinah Halaman ${pageNumber}`}
              className="w-full h-auto bg-white rounded-lg shadow-lg border border-amber-900/10"
              style={{
                filter: `brightness(${brightness}%) contrast(1.08)`
              }}
              onLoad={() => {
                setIsLoading(false);
                setHasError(false);
              }}
              onError={() => {
                setIsLoading(false);
                setHasError(true);
              }}
            />
          </div>
        )}
      </div>

      {/* Footer page indicator */}
      <div className="mt-3 text-center text-xs font-bold text-gray-400">
        Mushaf Standar Madinah (15 Baris) • Halaman {pageNumber} dari 604
      </div>
    </div>
  );
};

export default MushafPage;
