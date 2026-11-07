import { describe, expect, it } from 'vitest';
import { clampPlacement, cropRect, initialPlacement, zoomAround } from '../avatarCrop';

// Compares numbers by value (the crop maths can give -0 for 0)
const near = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expect.closeTo(v, 9)]));

describe('avatarCrop', () => {
  it('starts centred with the short side filling the frame', () => {
    // Landscape 400×200: twice as wide as the frame, half of the overhang on each side
    expect(initialPlacement(400, 200)).toEqual({ zoom: 1, x: -0.5, y: 0 });
    expect(cropRect(400, 200, initialPlacement(400, 200))).toEqual(near({ sx: 100, sy: 0, size: 200 }));
  });

  it('keeps the frame covered', () => {
    expect(clampPlacement(400, 200, { zoom: 1, x: 0.3, y: 0.3 })).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampPlacement(400, 200, { zoom: 1, x: -5, y: -5 })).toEqual({ zoom: 1, x: -1, y: 0 });
    expect(clampPlacement(400, 200, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
    expect(clampPlacement(400, 200, { zoom: 9, x: 0, y: 0 }).zoom).toBe(4);
  });

  it('zooms around the given point', () => {
    // Square picture, zoom 2 around the centre: shows the middle quarter
    const p = zoomAround(200, 200, initialPlacement(200, 200), 2);
    expect(p).toEqual({ zoom: 2, x: -0.5, y: -0.5 });
    expect(cropRect(200, 200, p)).toEqual(near({ sx: 50, sy: 50, size: 100 }));
    // Around the top left corner it stays there
    expect(zoomAround(200, 200, initialPlacement(200, 200), 2, 0, 0)).toEqual(near({ zoom: 2, x: 0, y: 0 }));
  });
});
