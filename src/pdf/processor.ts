import PDFDocument from 'pdf-lib/es/api/PDFDocument.js';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
} from 'pdf-lib/es/core/index.js';

import {
  analyzeContentStream,
  type CandidateCounts,
  type CandidateKind,
  type ContentAnalysis,
  type ConversionMode,
  rewriteContentStream,
  type SpotResourceNames,
} from './contentStream';
import { MAX_PDF_BYTES } from '../config';

export { MAX_PDF_BYTES };

const MAX_DECODED_CONTENT_BYTES = 128 * 1024 * 1024;
const COLOR_SPACE = PDFName.of('ColorSpace');
const DECODE_PARMS = PDFName.of('DecodeParms');
const FILTER = PDFName.of('Filter');
const LENGTH = PDFName.of('Length');
const SUBTYPE = PDFName.of('Subtype');

export interface PdfInspection {
  candidatePaths: number;
  contourCandidates: number;
  defaultMode: ConversionMode;
  pages: number;
  perfCandidates: number;
  primaryMode: CandidateKind | null;
}

export interface PdfConversionResult {
  convertedPaths: number;
  inspection: PdfInspection;
  output: Uint8Array;
}

export class PdfProcessingError extends Error {
  constructor(
    public readonly code:
      | 'ENCRYPTED'
      | 'INVALID_PDF'
      | 'NO_CUT_LINES'
      | 'TOO_COMPLEX'
      | 'UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'PdfProcessingError';
  }
}

interface DecodingBudget {
  remaining: number;
}

interface FormTarget {
  analysis: ContentAnalysis;
  ref: ReturnType<PDFDocument['context']['nextRef']>;
  stream: PDFRawStream;
}

interface PageTarget {
  analysis: ContentAnalysis;
  page: ReturnType<PDFDocument['getPages']>[number];
  resources: PDFDict;
}

interface DocumentAnalysis {
  forms: FormTarget[];
  inspection: PdfInspection;
  pages: PageTarget[];
  resourceDictionaries: PDFDict[];
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const headerLength = Math.min(bytes.length, 1024);
  return bytesToLatin1(bytes.subarray(0, headerLength)).includes('%PDF-');
}

function bytesToLatin1(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return chunks.join('');
}

function latin1ToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function consumeBudget(bytes: Uint8Array, budget: DecodingBudget): void {
  budget.remaining -= bytes.length;
  if (budget.remaining < 0) {
    throw new PdfProcessingError(
      'TOO_COMPLEX',
      'The PDF expands to too much drawing data to process safely in a browser.',
    );
  }
}

function decodeStream(stream: PDFStream, budget: DecodingBudget): string {
  try {
    const bytes =
      stream instanceof PDFRawStream
        ? decodePDFRawStream(stream).decode()
        : stream.getContents();
    consumeBudget(bytes, budget);
    return bytesToLatin1(bytes);
  } catch (error) {
    if (error instanceof PdfProcessingError) throw error;
    throw new PdfProcessingError(
      'UNSUPPORTED',
      'A PDF drawing stream uses an encoding that this app cannot safely rewrite.',
    );
  }
}

function addCounts(total: CandidateCounts, next: CandidateCounts): void {
  total.contour += next.contour;
  total.perf += next.perf;
}

function getPrimaryMode(counts: CandidateCounts): CandidateKind | null {
  if (counts.contour === 0 && counts.perf === 0) return null;
  return counts.perf > counts.contour ? 'perf' : 'contour';
}

function getDefaultMode(counts: CandidateCounts): ConversionMode {
  if (counts.contour > 0 && counts.perf > 0) return 'auto';
  if (counts.perf > 0) return 'perf';
  if (counts.contour > 0) return 'contour';
  return 'auto';
}

function streamFromArray(contents: PDFArray, index: number): PDFStream {
  const stream = contents.lookupMaybe(index, PDFStream);
  if (!stream) {
    throw new PdfProcessingError(
      'INVALID_PDF',
      'A page contains an invalid drawing stream.',
    );
  }
  return stream;
}

function collectPageTargets(
  document: PDFDocument,
  budget: DecodingBudget,
  resources: Set<PDFDict>,
): PageTarget[] {
  return document.getPages().flatMap((page) => {
    const entries = page.node.normalizedEntries();
    resources.add(entries.Resources);
    if (!entries.Contents || entries.Contents.size() === 0) return [];

    const streams: string[] = [];
    for (let index = 0; index < entries.Contents.size(); index += 1) {
      streams.push(decodeStream(streamFromArray(entries.Contents, index), budget));
    }

    return [{
      analysis: analyzeContentStream(streams.join('\n')),
      page,
      resources: entries.Resources,
    }];
  });
}

function isFormXObject(stream: PDFRawStream): boolean {
  return stream.dict.lookupMaybe(SUBTYPE, PDFName)?.decodeText() === 'Form';
}

function collectFormTargets(
  document: PDFDocument,
  budget: DecodingBudget,
  resources: Set<PDFDict>,
): FormTarget[] {
  const forms: FormTarget[] = [];

  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || !isFormXObject(object)) continue;
    const formResources = object.dict.lookupMaybe(PDFName.Resources, PDFDict);
    if (formResources) resources.add(formResources);
    forms.push({
      analysis: analyzeContentStream(decodeStream(object, budget)),
      ref,
      stream: object,
    });
  }

  return forms;
}

async function loadDocument(bytes: Uint8Array): Promise<PDFDocument> {
  if (!hasPdfHeader(bytes)) {
    throw new PdfProcessingError(
      'INVALID_PDF',
      'The selected file does not contain a valid PDF header.',
    );
  }

  try {
    return await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('encrypted')) {
      throw new PdfProcessingError(
        'ENCRYPTED',
        'Encrypted or password-protected PDFs are not supported.',
      );
    }
    throw new PdfProcessingError(
      'INVALID_PDF',
      'The PDF is damaged or uses a structure that could not be read.',
    );
  }
}

async function analyzeDocument(bytes: Uint8Array): Promise<{
  analysis: DocumentAnalysis;
  document: PDFDocument;
}> {
  const document = await loadDocument(bytes);
  const budget: DecodingBudget = { remaining: MAX_DECODED_CONTENT_BYTES };
  const resources = new Set<PDFDict>();
  const pages = collectPageTargets(document, budget, resources);
  const forms = collectFormTargets(document, budget, resources);
  const counts: CandidateCounts = { contour: 0, perf: 0 };

  pages.forEach((target) => addCounts(counts, target.analysis.counts));
  forms.forEach((target) => addCounts(counts, target.analysis.counts));

  return {
    analysis: {
      forms,
      inspection: {
        candidatePaths: counts.contour + counts.perf,
        contourCandidates: counts.contour,
        defaultMode: getDefaultMode(counts),
        pages: document.getPageCount(),
        perfCandidates: counts.perf,
        primaryMode: getPrimaryMode(counts),
      },
      pages,
      resourceDictionaries: [...resources],
    },
    document,
  };
}

function colorSpaceDictionary(resources: PDFDict): PDFDict {
  const existing = resources.lookupMaybe(COLOR_SPACE, PDFDict);
  if (existing) return existing;

  const created = resources.context.obj({});
  resources.set(COLOR_SPACE, created);
  return created;
}

function uniqueGlobalResourceName(
  resourceDictionaries: readonly PDFDict[],
  baseName: string,
): PDFName {
  let suffix = 0;
  while (true) {
    const candidate = PDFName.of(`${baseName}${suffix === 0 ? '' : suffix}`);
    const collision = resourceDictionaries.some((resources) =>
      colorSpaceDictionary(resources).has(candidate),
    );
    if (!collision) return candidate;
    suffix += 1;
  }
}

function createSpotColorSpace(
  document: PDFDocument,
  spotName: 'CutContour' | 'PerfCutContour',
  alternateCmyk: readonly [number, number, number, number],
) {
  const tintTransform = document.context.obj({
    C0: [0, 0, 0, 0],
    C1: alternateCmyk,
    Domain: [0, 1],
    FunctionType: 2,
    N: 1,
  });
  return document.context.register(
    document.context.obj([
      'Separation',
      spotName,
      'DeviceCMYK',
      tintTransform,
    ]),
  );
}

function installSpotColorSpaces(
  document: PDFDocument,
  resourceDictionaries: readonly PDFDict[],
): SpotResourceNames {
  const contourName = uniqueGlobalResourceName(
    resourceDictionaries,
    'ITVCutContour',
  );
  const perfName = uniqueGlobalResourceName(
    resourceDictionaries,
    'ITVPerfCutContour',
  );
  const contourSpace = createSpotColorSpace(
    document,
    'CutContour',
    [0, 1, 0, 0],
  );
  const perfSpace = createSpotColorSpace(
    document,
    'PerfCutContour',
    [0, 1, 1, 0],
  );

  resourceDictionaries.forEach((resources) => {
    const colorSpaces = colorSpaceDictionary(resources);
    colorSpaces.set(contourName, contourSpace);
    colorSpaces.set(perfName, perfSpace);
  });

  return {
    contour: contourName.decodeText(),
    perf: perfName.decodeText(),
  };
}

function replaceFormStream(
  document: PDFDocument,
  target: FormTarget,
  rewritten: string,
): void {
  const replacement = document.context.flateStream(latin1ToBytes(rewritten));
  target.stream.dict.entries().forEach(([key, value]) => {
    if (![LENGTH, FILTER, DECODE_PARMS].includes(key)) {
      replacement.dict.set(key, value);
    }
  });
  document.context.assign(target.ref, replacement);
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const { analysis } = await analyzeDocument(bytes);
  return analysis.inspection;
}

export async function convertPdf(
  bytes: Uint8Array,
  mode: ConversionMode,
): Promise<PdfConversionResult> {
  const { analysis, document } = await analyzeDocument(bytes);
  if (analysis.inspection.candidatePaths === 0) {
    throw new PdfProcessingError(
      'NO_CUT_LINES',
      'No magenta or red stroked vector paths were found. Check the cut-line color and confirm it is a vector stroke in Inkscape.',
    );
  }

  const resourceNames = installSpotColorSpaces(
    document,
    analysis.resourceDictionaries,
  );

  analysis.pages.forEach((target) => {
    if (target.analysis.candidateCommands.size === 0) return;
    const rewritten = rewriteContentStream(
      target.analysis,
      mode,
      resourceNames,
    );
    const replacement = document.context.register(
      document.context.flateStream(latin1ToBytes(rewritten)),
    );
    target.page.node.set(PDFName.Contents, replacement);
  });

  analysis.forms.forEach((target) => {
    if (target.analysis.candidateCommands.size === 0) return;
    replaceFormStream(
      document,
      target,
      rewriteContentStream(target.analysis, mode, resourceNames),
    );
  });

  const output = await document.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: false,
  });

  return {
    convertedPaths: analysis.inspection.candidatePaths,
    inspection: analysis.inspection,
    output,
  };
}
