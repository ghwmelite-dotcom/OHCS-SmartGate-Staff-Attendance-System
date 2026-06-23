// Pure decision for the ID-photo capture sequence. Ghana Card needs front + back;
// every other ID type (and an unset type) needs a single shot. Kept pure so it can be
// unit-tested without a DOM/camera harness.
export type IdCaptureSide = 'single' | 'front' | 'back';

export interface IdCaptureStep {
  side: IdCaptureSide;
  title: string;
}

export function idCaptureSteps(idType: string | undefined): IdCaptureStep[] {
  if (idType === 'ghana_card') {
    return [
      { side: 'front', title: 'Front of Ghana Card' },
      { side: 'back', title: 'Back of Ghana Card' },
    ];
  }
  return [{ side: 'single', title: 'Photograph the ID' }];
}
