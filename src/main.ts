import { MAX_PDF_BYTES } from './config';
import type { ConversionMode } from './pdf/contentStream';
import type { PdfInspection } from './pdf/processor';
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './pdf/workerMessages';

const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
  type: 'module',
});

type InspectRequest = Omit<
  Extract<PdfWorkerRequest, { action: 'inspect' }>,
  'id'
>;
type ConvertRequest = Omit<
  Extract<PdfWorkerRequest, { action: 'convert' }>,
  'id'
>;
type InspectResponse = Extract<
  PdfWorkerResponse,
  { action: 'inspect'; ok: true }
>;
type ConvertResponse = Extract<
  PdfWorkerResponse,
  { action: 'convert'; ok: true }
>;
type SuccessfulResponse = InspectResponse | ConvertResponse;

let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  {
    reject: (reason: Error) => void;
    resolve: (response: SuccessfulResponse) => void;
  }
>();

worker.addEventListener('message', (event: MessageEvent<PdfWorkerResponse>) => {
  const pending = pendingRequests.get(event.data.id);
  if (!pending) return;
  pendingRequests.delete(event.data.id);

  if (!event.data.ok) {
    pending.reject(new Error(event.data.error.message));
    return;
  }

  pending.resolve(event.data);
});

worker.addEventListener('error', () => {
  pendingRequests.forEach(({ reject }) => {
    reject(new Error('The local PDF processor stopped unexpectedly.'));
  });
  pendingRequests.clear();
});

function sendWorkerRequest(request: InspectRequest): Promise<InspectResponse>;
function sendWorkerRequest(request: ConvertRequest): Promise<ConvertResponse>;
function sendWorkerRequest(
  request: InspectRequest | ConvertRequest,
): Promise<SuccessfulResponse> {
  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { reject, resolve });
    const message = { ...request, id } as PdfWorkerRequest;
    worker.postMessage(message, [message.bytes]);
  });
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required page element: ${id}`);
  return element as T;
}

const announcer = getElement<HTMLDivElement>('announcer');
const browseButton = getElement<HTMLButtonElement>('browseButton');
const contourCount = getElement<HTMLElement>('contourCount');
const convertButton = getElement<HTMLButtonElement>('convertButton');
const detectionNote = getElement<HTMLParagraphElement>('detectionNote');
const downloadLink = getElement<HTMLAnchorElement>('downloadLink');
const dropZone = getElement<HTMLDivElement>('dropZone');
const errorMessage = getElement<HTMLSpanElement>('errorMessage');
const errorPanel = getElement<HTMLDivElement>('errorPanel');
const fileInput = getElement<HTMLInputElement>('fileInput');
const fileMetadata = getElement<HTMLSpanElement>('fileMetadata');
const fileName = getElement<HTMLElement>('fileName');
const filePanel = getElement<HTMLElement>('filePanel');
const modePanel = getElement<HTMLElement>('modePanel');
const perfCount = getElement<HTMLElement>('perfCount');
const replaceButton = getElement<HTMLButtonElement>('replaceButton');
const resultMessage = getElement<HTMLParagraphElement>('resultMessage');
const resultPanel = getElement<HTMLElement>('resultPanel');
const statusMessage = getElement<HTMLSpanElement>('statusMessage');
const statusPanel = getElement<HTMLDivElement>('statusPanel');
const statusSpinner = getElement<HTMLDivElement>('statusSpinner');
const statusTitle = getElement<HTMLElement>('statusTitle');
const modeInputs = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="cutMode"]'),
];

let activeFile: File | null = null;
let activeFileBytes: ArrayBuffer | null = null;
let activeInspection: PdfInspection | null = null;
let activeDownloadUrl: string | null = null;
let selectedMode: ConversionMode = 'auto';
let selectionVersion = 0;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function revokeDownload(): void {
  if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
  activeDownloadUrl = null;
  downloadLink.removeAttribute('href');
}

function hideError(): void {
  errorPanel.hidden = true;
  errorMessage.textContent = '';
}

function showError(message: string): void {
  statusPanel.hidden = true;
  errorMessage.textContent = message;
  errorPanel.hidden = false;
  announcer.textContent = message;
}

function setStatus(
  title: string,
  message: string,
  spinning = true,
): void {
  statusTitle.textContent = title;
  statusMessage.textContent = message;
  statusSpinner.hidden = !spinning;
  statusPanel.hidden = false;
  announcer.textContent = `${title}. ${message}`;
}

function clearResult(): void {
  revokeDownload();
  resultPanel.hidden = true;
  resultMessage.textContent = '';
}

function selectMode(mode: ConversionMode): void {
  selectedMode = mode;
  modeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function describeDetection(inspection: PdfInspection): string {
  const contour = pluralize(inspection.contourCandidates, 'magenta path');
  const perf = pluralize(inspection.perfCandidates, 'red path');

  if (inspection.contourCandidates > 0 && inspection.perfCandidates > 0) {
    return `Mixed cut lines detected: ${contour} and ${perf}. Auto-detect preserves both mappings.`;
  }
  if (inspection.contourCandidates > 0) {
    return `${contour} detected. Contour cut is selected by default.`;
  }
  if (inspection.perfCandidates > 0) {
    return `${perf} detected. Full perf cut is selected by default.`;
  }
  return 'No magenta or red stroked vector paths were detected.';
}

function renderInspection(file: File, inspection: PdfInspection): void {
  fileName.textContent = file.name;
  fileMetadata.textContent = `${formatFileSize(file.size)} · ${pluralize(
    inspection.pages,
    'page',
  )}`;
  contourCount.textContent = String(inspection.contourCandidates);
  perfCount.textContent = String(inspection.perfCandidates);
  detectionNote.textContent = describeDetection(inspection);
  selectMode(inspection.defaultMode);

  dropZone.hidden = true;
  statusPanel.hidden = true;
  filePanel.hidden = false;
  modePanel.hidden = inspection.candidatePaths === 0;

  if (inspection.candidatePaths === 0) {
    showError(
      'No eligible cut lines were found. Use a magenta or red vector stroke in Inkscape, export again, and keep the path as vector artwork.',
    );
  } else {
    announcer.textContent = `${pluralize(
      inspection.candidatePaths,
      'cut-line candidate',
    )} detected.`;
  }
}

function hasPdfExtension(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

async function inspectFile(file: File): Promise<void> {
  selectionVersion += 1;
  const currentVersion = selectionVersion;
  activeFile = null;
  activeFileBytes = null;
  activeInspection = null;
  filePanel.hidden = true;
  modePanel.hidden = true;
  dropZone.hidden = false;
  statusPanel.hidden = true;
  hideError();
  clearResult();

  if (!hasPdfExtension(file)) {
    showError('Choose a file with a .pdf extension.');
    return;
  }
  if (file.size === 0) {
    showError('The selected PDF is empty.');
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    showError('This PDF is larger than the 50 MB browser-processing limit.');
    return;
  }

  dropZone.hidden = true;
  setStatus('Inspecting PDF', 'Looking for magenta and red vector strokes...');

  try {
    const bytes = await file.arrayBuffer();
    const response = await sendWorkerRequest({
      action: 'inspect',
      bytes: bytes.slice(0),
    });
    if (selectionVersion !== currentVersion || response.action !== 'inspect') return;

    activeFile = file;
    activeFileBytes = bytes;
    activeInspection = response.inspection;
    renderInspection(file, response.inspection);
  } catch (error) {
    if (selectionVersion !== currentVersion) return;
    activeFile = null;
    activeFileBytes = null;
    activeInspection = null;
    dropZone.hidden = false;
    showError(
      error instanceof Error ? error.message : 'The PDF could not be inspected.',
    );
  }
}

function outputFileName(inputName: string): string {
  const baseName = inputName.replace(/\.pdf$/i, '').trim() || 'inkscape-artwork';
  return `${baseName}-versaworks.pdf`;
}

async function convertActiveFile(): Promise<void> {
  if (!activeFile || !activeFileBytes || !activeInspection) return;

  hideError();
  clearResult();
  convertButton.disabled = true;
  setStatus(
    'Creating VersaWorks PDF',
    'Adding Roland spot colors while preserving your artwork...',
  );

  try {
    const response = await sendWorkerRequest({
      action: 'convert',
      bytes: activeFileBytes.slice(0),
      mode: selectedMode,
    });
    if (response.action !== 'convert') {
      throw new Error('The PDF processor returned an unexpected result.');
    }

    const blob = new Blob([response.result.output], {
      type: 'application/pdf',
    });
    activeDownloadUrl = URL.createObjectURL(blob);
    downloadLink.href = activeDownloadUrl;
    downloadLink.download = outputFileName(activeFile.name);
    resultMessage.textContent = `${pluralize(
      response.result.convertedPaths,
      'vector path',
    )} converted to VersaWorks spot colors.`;
    statusPanel.hidden = true;
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    announcer.textContent = 'Your converted VersaWorks PDF is ready to download.';
  } catch (error) {
    showError(
      error instanceof Error ? error.message : 'The PDF could not be converted.',
    );
  } finally {
    convertButton.disabled = false;
  }
}

function openFilePicker(): void {
  fileInput.value = '';
  fileInput.click();
}

browseButton.addEventListener('click', openFilePicker);
replaceButton.addEventListener('click', openFilePicker);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void inspectFile(file);
});

modeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      selectedMode = input.value as ConversionMode;
      clearResult();
    }
  });
});

convertButton.addEventListener('click', () => void convertActiveFile());

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
});

dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) void inspectFile(file);
});

window.addEventListener('beforeunload', () => {
  revokeDownload();
  worker.terminate();
});
