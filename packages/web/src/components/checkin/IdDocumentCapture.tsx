import { useEffect, useState } from 'react';
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

  // Reset the sequence whenever the chosen ID type changes mid-capture, so the
  // component is self-contained — the parent does not need to re-key it. (e.g. the
  // visitor picks Ghana Card, captures the front, then switches to Passport.)
  useEffect(() => {
    setIndex(0);
    setFront(null);
  }, [idType]);

  // Clamp the index so the render between an idType change and the reset effect
  // committing can never point past the (possibly shorter) new step list — which
  // would throw under `noUncheckedIndexedAccess`.
  const safeIndex = Math.min(index, steps.length - 1);
  const step = steps[safeIndex]!;
  const isLastStep = safeIndex >= steps.length - 1;

  function handleCapture(blob: Blob) {
    if (step.side === 'back') {
      // Back of the Ghana Card. The front is expected; if state was unexpectedly
      // reset, treat this shot as the front so the flow can never get stuck.
      onComplete(front ? { front, back: blob } : { front: blob });
      return;
    }
    // 'single' or 'front'
    if (isLastStep) {
      onComplete({ front: blob }); // single-shot path
    } else {
      setFront(blob);
      setIndex(safeIndex + 1);
    }
  }

  function handleSkip() {
    // Skipping the first step cancels the whole ID capture.
    if (safeIndex === 0) { onSkip(); return; }
    // Skipping a later (back) step completes with whatever was already captured.
    if (front) onComplete({ front });
    else onSkip();
  }

  return (
    <PhotoCapture
      // Remount cleanly when the step changes so the camera restarts for each shot.
      key={`${idType ?? 'none'}-${safeIndex}`}
      title={step.title}
      facingMode="environment"
      mirror={false}
      required={required}
      qualityGuard={qualityGuard}
      onCapture={handleCapture}
      onSkip={handleSkip}
    />
  );
}
