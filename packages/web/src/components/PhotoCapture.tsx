import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, RotateCcw, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolvePhotoUrl } from '@/lib/api';

interface PhotoCaptureProps {
  onCapture: (blob: Blob) => void;
  onSkip: () => void;
  existingPhotoUrl?: string | null;
  /** 'user' = front/selfie camera (default), 'environment' = rear camera (for IDs). */
  facingMode?: 'user' | 'environment';
  /** Heading shown above the camera. Defaults to a face-capture label. */
  title?: string;
  /** Mirror the preview/capture horizontally. Defaults true for selfies, set false for IDs. */
  mirror?: boolean;
}

export function PhotoCapture({
  onCapture,
  onSkip,
  existingPhotoUrl,
  facingMode = 'user',
  title,
  mirror = facingMode === 'user',
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 640 }, facingMode },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch {
      setCameraError(true);
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (!existingPhotoUrl) {
      startCamera();
    }
    return () => stopCamera();
  }, [existingPhotoUrl, startCamera, stopCamera]);

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Square crop from center of video
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;

    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;

    if (mirror) {
      // Mirror horizontally for natural selfie feel
      ctx.translate(400, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 400, 400);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCaptured(canvas.toDataURL('image/jpeg', 0.85));
          setCapturedBlob(blob);
          stopCamera();
        }
      },
      'image/jpeg',
      0.85
    );
  }

  function retake() {
    setCaptured(null);
    setCapturedBlob(null);
    startCamera();
  }

  function usePhoto() {
    if (capturedBlob) onCapture(capturedBlob);
  }

  // Existing photo — show it with update option
  if (existingPhotoUrl && !captured) {
    return (
      <div className="text-center space-y-4 animate-fade-in">
        <p className="text-[14px] font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          Visitor Photo
        </p>
        <div className="w-32 h-32 rounded-2xl overflow-hidden mx-auto border-2 border-border shadow-md">
          <img src={resolvePhotoUrl(existingPhotoUrl)!} alt="Visitor" className="w-full h-full object-cover" />
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => startCamera()}
            className="inline-flex items-center gap-2 h-10 px-4 text-[13px] font-medium text-muted border border-border rounded-xl hover:border-primary/30 hover:text-foreground transition-all"
          >
            <Camera className="h-4 w-4" />
            Update Photo
          </button>
          <button
            onClick={onSkip}
            className="h-10 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4 animate-fade-in">
      <p className="text-[14px] font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
        {captured ? 'Photo Preview' : (title ?? 'Capture Visitor Photo')}
      </p>

      {/* Camera / Preview */}
      <div className="relative w-48 h-48 mx-auto">
        {/* Circular guide */}
        <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-accent/40 z-10 pointer-events-none" />

        {!captured ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                'w-48 h-48 rounded-2xl object-cover bg-primary-deep',
                cameraReady ? 'opacity-100' : 'opacity-0',
                mirror && 'scale-x-[-1]' // Mirror only for selfies
              )}
            />
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background border border-border">
                <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-background border border-border p-4">
                <Camera className="h-6 w-6 text-muted-foreground mb-2" />
                <p className="text-[12px] text-muted text-center">Camera unavailable</p>
              </div>
            )}
          </>
        ) : (
          <img src={captured} alt="Captured" className="w-48 h-48 rounded-2xl object-cover" />
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Actions */}
      <div className="flex items-center justify-center gap-3">
        {!captured ? (
          <>
            <button
              onClick={onSkip}
              className="h-10 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            >
              Skip Photo
            </button>
            <button
              onClick={capture}
              disabled={!cameraReady}
              className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15 active:scale-[0.98]"
            >
              <Camera className="h-4 w-4" />
              Capture
            </button>
          </>
        ) : (
          <>
            <button
              onClick={retake}
              className="inline-flex items-center gap-2 h-10 px-4 text-[13px] font-medium text-muted border border-border rounded-xl hover:text-foreground hover:border-primary/30 transition-all"
            >
              <RotateCcw className="h-4 w-4" />
              Retake
            </button>
            <button
              onClick={usePhoto}
              className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
            >
              <Check className="h-4 w-4" />
              Use Photo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
