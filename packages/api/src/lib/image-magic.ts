// Magic-byte sniff for uploaded photos. Every capture surface in the apps
// produces JPEG (canvas.toBlob('image/jpeg', …)) and the R2 objects are served
// back with Content-Type: image/jpeg, so we accept JPEG only and reject anything
// whose first bytes aren't the JPEG SOI + marker (FF D8 FF). This blocks a
// client from smuggling non-image bytes (HTML/scripts/etc.) into R2.

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
