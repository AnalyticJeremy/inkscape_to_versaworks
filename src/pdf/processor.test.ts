import PDFDocument from 'pdf-lib/es/api/PDFDocument.js';
import { rgb, setStrokingColor } from 'pdf-lib/es/api/colors.js';
import {
  lineTo,
  moveTo,
  setLineWidth,
  stroke,
} from 'pdf-lib/es/api/operators.js';
import { describe, expect, it } from 'vitest';

import { convertPdf, inspectPdf } from './processor';

async function createTestPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([200, 200]);
  page.pushOperators(
    setStrokingColor(rgb(1, 0, 1)),
    setLineWidth(0.25),
    moveTo(10, 10),
    lineTo(190, 10),
    stroke(),
    setStrokingColor(rgb(1, 0, 0)),
    moveTo(10, 20),
    lineTo(190, 20),
    stroke(),
  );
  return document.save();
}

describe('PDF processing', () => {
  it('inspects mixed cut-line candidates', async () => {
    const inspection = await inspectPdf(await createTestPdf());

    expect(inspection).toMatchObject({
      candidatePaths: 2,
      contourCandidates: 1,
      defaultMode: 'auto',
      pages: 1,
      perfCandidates: 1,
      primaryMode: 'contour',
    });
  });

  it('writes the exact VersaWorks spot-color names', async () => {
    const result = await convertPdf(await createTestPdf(), 'auto');
    const serialized = new TextDecoder('latin1').decode(result.output);

    expect(serialized).toContain('/CutContour');
    expect(serialized).toContain('/PerfCutContour');
    expect(serialized).toContain('/Separation');
    expect(await PDFDocument.load(result.output)).toBeDefined();
  });
});
