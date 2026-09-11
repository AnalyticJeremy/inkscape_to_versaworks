import { describe, expect, it } from 'vitest';

import {
  analyzeContentStream,
  rewriteContentStream,
} from './contentStream';

const resourceNames = {
  contour: 'ContourResource',
  perf: 'PerfResource',
};

describe('PDF content stream cut-line detection', () => {
  it('detects tolerant RGB magenta and exact RGB red strokes', () => {
    const analysis = analyzeContentStream(`
      0.96 0.03 0.97 RG
      0 0 m 10 10 l S
      1 0 0 RG
      10 10 m 20 20 l S
    `);

    expect(analysis.counts).toEqual({ contour: 1, perf: 1 });
  });

  it('detects CMYK cut colors and ignores fill-only paths', () => {
    const analysis = analyzeContentStream(`
      0 1 0 0 K
      0 0 m 10 10 l B
      0 1 1 0 K
      10 10 m 20 20 l f
    `);

    expect(analysis.counts).toEqual({ contour: 1, perf: 0 });
  });

  it('restores stroking colors across graphics state saves', () => {
    const analysis = analyzeContentStream(`
      1 0 1 RG
      q
      0 0 0 RG
      0 0 m 10 10 l S
      Q
      10 10 m 20 20 l S
    `);

    expect(analysis.counts).toEqual({ contour: 1, perf: 0 });
  });

  it('rewrites auto mode with separate spot resources', () => {
    const analysis = analyzeContentStream(`
      1 0 1 RG 0 0 m 10 10 l S
      1 0 0 RG 10 10 m 20 20 l S
    `);
    const rewritten = rewriteContentStream(
      analysis,
      'auto',
      resourceNames,
    );

    expect(rewritten).toContain('/ContourResource CS 1 SCN');
    expect(rewritten).toContain('/PerfResource CS 1 SCN');
    expect(rewritten).not.toContain('1 0 1 RG');
    expect(rewritten).not.toContain('1 0 0 RG');
  });

  it('forces every candidate to the selected cut mode', () => {
    const analysis = analyzeContentStream(`
      1 0 1 RG 0 0 m 10 10 l S
      1 0 0 RG 10 10 m 20 20 l S
    `);
    const rewritten = rewriteContentStream(
      analysis,
      'contour',
      resourceNames,
    );

    expect(rewritten.match(/\/ContourResource CS 1 SCN/g)).toHaveLength(2);
    expect(rewritten).not.toContain('/PerfResource');
  });
});
