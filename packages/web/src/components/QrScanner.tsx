import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X } from 'lucide-react';
import { parseBadgeCode } from '@/lib/badgeCode';

interface QrScannerProps {
  /** Called with the parsed code once a QR is decoded and accepted by `parse`. */
  onScan: (code: string) => void;
  /** Called when the user cancels scanning. */
  onCancel: () => void;
  /** Extracts the expected code from raw QR text. Defaults to badge parsing. */
  parse?: (raw: string) => string | null;
  /** Called once when a QR decodes but `parse` rejects it (scanning stops). */
  onReject?: (raw: string) => void;
  /** Heading shown above the viewfinder. */
  label?: string;
}

export function QrScanner({ onScan, onCancel, parse, onReject, label }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          tick();
        }
      } catch {
        setCameraError(true);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || doneRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(img.data, img.width, img.height);
        if (result) {
          const code = (parse ?? parseBadgeCode)(result.data);
          if (code) {
            doneRef.current = true;
            onScan(code);
            return;
          }
          if (onReject) {
            doneRef.current = true;
            onReject(result.data);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      doneRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onScan, parse, onReject]);

  return (
    <div className="text-center space-y-4">
      <p className="text-sm font-medium text-foreground">{label ?? "Scan the visitor's badge QR code"}</p>
      <div className="relative w-64 h-64 mx-auto rounded-2xl overflow-hidden bg-primary-deep">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <div className="absolute inset-6 border-2 border-white/70 rounded-xl pointer-events-none" />
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background p-4">
            <Camera className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-xs text-muted text-center">Camera unavailable — enter the code manually.</p>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-muted border border-border rounded-xl hover:text-foreground transition-all"
      >
        <X className="h-4 w-4" />
        Cancel
      </button>
    </div>
  );
}
