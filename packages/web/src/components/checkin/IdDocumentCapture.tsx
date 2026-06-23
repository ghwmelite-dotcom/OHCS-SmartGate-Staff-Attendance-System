import { useState } from 'react';
import { PhotoCapture } from '@/components/PhotoCapture';
import { idCaptureSteps } from '@/lib/id-capture';

export interface IdDocumentResult {
  front: Blob;
  back?: Blob;
}

export function IdDocumentCapture({
  idType,
  onComplete,
  onSkip,
  required = false,
  qualityGuard = false,
}: {
  idType: string | undefined;
  onComplete: (result: IdDocumentResult) => void;
  onSkip: () => void;
  required?: boolean;
  qualityGuard?: boolean;
}) {
  const steps = idCaptureSteps(idType);
  const [index, setIndex] = useState(0);
  const [front, setFront] = useState<Blob | null>(null);
  const step = steps[index];

  function finish(frontBlob: Blob, backBlob?: Blob) {
    onComplete({ front: frontBlob, back: backBlob });
  }

  function handleCapture(blob: Blob) {
    // Single-shot, or the first shot of the Ghana Card pair.
    if (step!.side === 'single' || step!.side === 'front') {
      if (index + 1 < steps.length) {
        setFront(blob);
        setIndex(index + 1);
      } else {
        finish(blob); // single-shot path
      }
      return;
    }
    // Back of the Ghana Card — front must already be captured.
    if (front) finish(front, blob);
  }

  function handleSkip() {
    // Skipping the first step cancels the whole ID capture.
    if (index === 0) { onSkip(); return; }
    // Skipping a later (back) step completes with whatever was captured.
    if (front) finish(front);
    else onSkip();
  }

  return (
    <PhotoCapture
      // Remount cleanly when the step changes so the camera restarts for each shot.
      key={`${idType ?? 'none'}-${index}`}
      title={step!.title}
      facingMode="environment"
      mirror={false}
      required={required}
      qualityGuard={qualityGuard}
      onCapture={handleCapture}
      onSkip={handleSkip}
    />
  );
}
