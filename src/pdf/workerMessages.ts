import type {
  PdfConversionResult,
  PdfInspection,
} from './processor';
import type { ConversionMode } from './contentStream';

export type PdfWorkerRequest =
  | {
      action: 'inspect';
      bytes: ArrayBuffer;
      id: number;
    }
  | {
      action: 'convert';
      bytes: ArrayBuffer;
      id: number;
      mode: ConversionMode;
    };

export type PdfWorkerResponse =
  | {
      action: 'inspect';
      id: number;
      inspection: PdfInspection;
      ok: true;
    }
  | {
      action: 'convert';
      id: number;
      ok: true;
      result: Omit<PdfConversionResult, 'output'> & { output: ArrayBuffer };
    }
  | {
      error: {
        code: string;
        message: string;
      };
      id: number;
      ok: false;
    };
