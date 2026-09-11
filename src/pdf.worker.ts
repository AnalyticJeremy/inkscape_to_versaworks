/// <reference lib="webworker" />

import { convertPdf, inspectPdf, PdfProcessingError } from './pdf/processor';
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdf/workerMessages';

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener('message', async (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.action === 'inspect') {
      const inspection = await inspectPdf(new Uint8Array(request.bytes));
      const response: PdfWorkerResponse = {
        action: 'inspect',
        id: request.id,
        inspection,
        ok: true,
      };
      worker.postMessage(response);
      return;
    }

    const result = await convertPdf(
      new Uint8Array(request.bytes),
      request.mode,
    );
    const output = result.output.buffer.slice(
      result.output.byteOffset,
      result.output.byteOffset + result.output.byteLength,
    ) as ArrayBuffer;
    const response: PdfWorkerResponse = {
      action: 'convert',
      id: request.id,
      ok: true,
      result: {
        convertedPaths: result.convertedPaths,
        inspection: result.inspection,
        output,
      },
    };
    worker.postMessage(response, [output]);
  } catch (error) {
    const response: PdfWorkerResponse = {
      error: {
        code: error instanceof PdfProcessingError ? error.code : 'UNKNOWN',
        message:
          error instanceof Error
            ? error.message
            : 'The PDF could not be processed.',
      },
      id: request.id,
      ok: false,
    };
    worker.postMessage(response);
  }
});
