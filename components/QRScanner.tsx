import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanFailure?: (error: any) => void;
}

const qrcodeRegionId = "html5qr-code-full-region";

const QRScanner: React.FC<QRScannerProps> = ({ onScanSuccess, onScanFailure }) => {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(qrcodeRegionId);
    html5QrCodeRef.current = html5QrCode;

    let isUnmounted = false;

    // Start camera immediately on mount
    html5QrCode.start(
      { facingMode: "environment" }, // Prioritaskan kamera belakang
      {
        fps: 15,
        qrbox: { width: 220, height: 220 }
      },
      (decodedText) => {
        if (!isUnmounted) {
          onScanSuccess(decodedText);
        }
      },
      (error) => {
        if (!isUnmounted && onScanFailure) {
          onScanFailure(error);
        }
      }
    )
    .catch((err) => {
      console.error("Gagal memulai kamera otomatis:", err);
    });

    return () => {
      isUnmounted = true;
      if (html5QrCodeRef.current) {
        const scanner = html5QrCodeRef.current;
        if (scanner.isScanning) {
          scanner.stop()
            .then(() => {
              console.log("Kamera dihentikan.");
            })
            .catch((err) => {
              console.error("Gagal menghentikan kamera:", err);
            });
        }
      }
    };
  }, [onScanSuccess, onScanFailure]);

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl border border-gray-200 bg-black relative flex flex-col items-center justify-center">
      {/* Video stream container */}
      <div id={qrcodeRegionId} className="w-full h-[280px]"></div>
      
      {/* Visual scan area overlay */}
      <div className="absolute inset-0 border-2 border-dashed border-emerald-500 pointer-events-none rounded-2xl m-8"></div>
      
      <p className="absolute bottom-4 text-white text-xs bg-black/60 px-3 py-1 rounded-full pointer-events-none">
        Posisikan QR Code di dalam kotak
      </p>
    </div>
  );
};

export default QRScanner;
