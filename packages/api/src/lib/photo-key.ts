// Centralised R2 object-key construction for visitor photos so the upload and
// serve paths can never drift apart.
export function visitorPhotoKey(visitorId: string): string {
  return `photos/visitors/${visitorId}.jpg`;
}

export function visitorIdPhotoKey(visitorId: string): string {
  return `photos/visitors/${visitorId}-id.jpg`;
}
