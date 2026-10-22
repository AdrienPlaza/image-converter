import { describe, expect, it } from 'vitest';
import { needsAlphaFlatten, planConversion } from '../src/core/converter';
import type { ResizeOptions } from '../src/core/resize';

const NO_RESIZE: ResizeOptions = { enabled: false, width: null, height: null, keepRatio: true };

describe('planConversion', () => {
  it('conserve les dimensions et signale l’aplatissement alpha', () => {
    const plan = planConversion('png', 400, 200, 'jpeg', NO_RESIZE, '#000000');
    expect(plan.width).toBe(400);
    expect(plan.height).toBe(200);
    expect(plan.warnings).toEqual([
      { code: 'alpha-flattened', params: { background: '#000000' } },
    ]);
  });

  it('ne signale pas l’alpha quand la source n’en a pas', () => {
    expect(planConversion('jpeg', 100, 100, 'jpeg', NO_RESIZE, '#ffffff').warnings).toEqual([]);
  });

  it('réduit les ICO à 256 px en conservant le ratio', () => {
    const plan = planConversion('png', 400, 200, 'ico', NO_RESIZE, '#ffffff');
    expect(plan.width).toBe(256);
    expect(plan.height).toBe(128);
    expect(plan.warnings.map((warning) => warning.code)).toContain('ico-resized');
  });

  it('signale un agrandissement', () => {
    const resize: ResizeOptions = { enabled: true, width: 500, height: null, keepRatio: true };
    const plan = planConversion('png', 100, 100, 'png', resize, '#ffffff');
    expect(plan.width).toBe(500);
    expect(plan.height).toBe(500);
    expect(plan.warnings.map((warning) => warning.code)).toContain('upscaled');
  });

  it('conserve l’alpha des GIF et l’aplatit seulement sur demande', () => {
    expect(needsAlphaFlatten('gif')).toBe(false);
    expect(needsAlphaFlatten('gif', false)).toBe(true);
    expect(needsAlphaFlatten('png')).toBe(false);
    expect(needsAlphaFlatten('png', false)).toBe(true);
    expect(needsAlphaFlatten('jpeg')).toBe(true);
    expect(needsAlphaFlatten('bmp')).toBe(true);
  });

  it('ne signale l’aplatissement que s’il est réellement appliqué', () => {
    const transparentGif = planConversion('png', 10, 10, 'gif', NO_RESIZE, '#000000', true);
    expect(transparentGif.warnings).toEqual([]);

    const opaqueGif = planConversion('png', 10, 10, 'gif', NO_RESIZE, '#000000', false);
    expect(opaqueGif.warnings).toEqual([
      { code: 'alpha-flattened', params: { background: '#000000' } },
    ]);

    const jpeg = planConversion('png', 10, 10, 'jpeg', NO_RESIZE, '#ffffff', true);
    expect(jpeg.warnings.map((warning) => warning.code)).toContain('alpha-flattened');
  });
});
