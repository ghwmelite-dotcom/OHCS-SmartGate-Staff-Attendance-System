import { describe, it, expect } from 'vitest';
import { visitorPhotoKey, visitorIdPhotoKey } from './photo-key';

describe('visitorPhotoKey', () => {
  it('builds the R2 key for a visitor face photo', () => {
    expect(visitorPhotoKey('abc123')).toBe('photos/visitors/abc123.jpg');
  });
});

describe('visitorIdPhotoKey', () => {
  it('builds the R2 key for a visitor ID-document photo', () => {
    expect(visitorIdPhotoKey('abc123')).toBe('photos/visitors/abc123-id.jpg');
  });
});
