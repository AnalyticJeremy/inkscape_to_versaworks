export type CandidateKind = 'contour' | 'perf';
export type ConversionMode = 'auto' | CandidateKind;

export interface CandidateCounts {
  contour: number;
  perf: number;
}

interface Token {
  end: number;
  start: number;
  value: string;
}

interface Command {
  end: number;
  operator: string;
  operands: Token[];
  start: number;
}

interface CandidateSource {
  commandIndex: number;
  kind: CandidateKind;
}

interface GraphicsState {
  candidate: CandidateSource | null;
  strokeColorSpace: string | null;
}

export interface ContentAnalysis {
  candidateCommands: ReadonlyMap<number, CandidateKind>;
  commands: readonly Command[];
  counts: CandidateCounts;
  source: string;
}

export interface SpotResourceNames {
  contour: string;
  perf: string;
}

const COLOR_TOLERANCE = 0.09;
const STROKING_OPERATORS = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const WHITESPACE = new Set(['\u0000', '\t', '\n', '\f', '\r', ' ']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && WHITESPACE.has(character);
}

function isDelimiter(character: string | undefined): boolean {
  return character !== undefined && DELIMITERS.has(character);
}

function isNumber(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value);
}

function readLiteralString(source: string, start: number): number {
  let depth = 1;
  let index = start + 1;

  while (index < source.length && depth > 0) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    index += 1;
  }

  return index;
}

function readHexString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && source[index] !== '>') index += 1;
  return Math.min(index + 1, source.length);
}

function readName(source: string, start: number): number {
  let index = start + 1;
  while (
    index < source.length &&
    !isWhitespace(source[index]) &&
    !isDelimiter(source[index])
  ) {
    index += 1;
  }
  return index;
}

function readRegularToken(source: string, start: number): number {
  let index = start;
  while (
    index < source.length &&
    !isWhitespace(source[index]) &&
    !isDelimiter(source[index])
  ) {
    index += 1;
  }
  return index;
}

function findInlineImageEnd(source: string, start: number): number {
  const idMatch = /(?:^|[\u0000\t\n\f\r ])ID(?=[\u0000\t\n\f\r ])/g;
  idMatch.lastIndex = start;
  const idResult = idMatch.exec(source);
  if (!idResult) return source.length;

  const imageStart = idResult.index + idResult[0].length;
  const endMatch = /[\u0000\t\n\f\r ]EI(?=[\u0000\t\n\f\r ])/g;
  endMatch.lastIndex = imageStart;
  const endResult = endMatch.exec(source);
  if (!endResult) return source.length;

  return endResult.index + endResult[0].length;
}

function tokenizeCommands(source: string): Command[] {
  const commands: Command[] = [];
  const operands: Token[] = [];
  const nesting: string[] = [];
  let commandStart: number | null = null;
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    if (character === '%') {
      while (index < source.length && !['\n', '\r'].includes(source[index] ?? '')) {
        index += 1;
      }
      continue;
    }

    const tokenStart = index;
    let tokenEnd = index + 1;

    if (character === '(') {
      tokenEnd = readLiteralString(source, index);
    } else if (character === '<' && source[index + 1] !== '<') {
      tokenEnd = readHexString(source, index);
    } else if (character === '/') {
      tokenEnd = readName(source, index);
    } else if (
      (character === '<' && source[index + 1] === '<') ||
      (character === '>' && source[index + 1] === '>')
    ) {
      tokenEnd = index + 2;
    } else if (!isDelimiter(character)) {
      tokenEnd = readRegularToken(source, index);
    }

    const token: Token = {
      end: tokenEnd,
      start: tokenStart,
      value: source.slice(tokenStart, tokenEnd),
    };
    commandStart ??= tokenStart;
    index = tokenEnd;

    if (['[', '<<', '{'].includes(token.value)) {
      nesting.push(token.value);
      operands.push(token);
      continue;
    }

    if ([']', '>>', '}'].includes(token.value)) {
      nesting.pop();
      operands.push(token);
      continue;
    }

    const isOperator =
      nesting.length === 0 &&
      !token.value.startsWith('/') &&
      !isNumber(token.value) &&
      !token.value.startsWith('(') &&
      !token.value.startsWith('<');

    if (!isOperator) {
      operands.push(token);
      continue;
    }

    if (token.value === 'BI') {
      const inlineImageEnd = findInlineImageEnd(source, token.end);
      commands.push({
        end: inlineImageEnd,
        operator: 'INLINE_IMAGE',
        operands: [],
        start: commandStart,
      });
      index = inlineImageEnd;
    } else {
      commands.push({
        end: token.end,
        operator: token.value,
        operands: [...operands],
        start: commandStart,
      });
    }

    commandStart = null;
    operands.length = 0;
    nesting.length = 0;
  }

  return commands;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function classifyRgb(red: number, green: number, blue: number): CandidateKind | null {
  const rgb = [clamp(red), clamp(green), clamp(blue)];
  const isNear = (target: readonly number[]) =>
    rgb.every((component, index) => {
      const targetComponent = target[index];
      return targetComponent !== undefined &&
        Math.abs(component - targetComponent) <= COLOR_TOLERANCE;
    });

  if (isNear([1, 0, 1])) return 'contour';
  if (isNear([1, 0, 0])) return 'perf';
  return null;
}

function classifyCmyk(
  cyan: number,
  magenta: number,
  yellow: number,
  black: number,
): CandidateKind | null {
  return classifyRgb(
    1 - Math.min(1, cyan + black),
    1 - Math.min(1, magenta + black),
    1 - Math.min(1, yellow + black),
  );
}

function numericOperands(command: Command): number[] | null {
  const values = command.operands.map((operand) => Number(operand.value));
  return values.every(Number.isFinite) ? values : null;
}

function candidateForColorCommand(
  command: Command,
  commandIndex: number,
  colorSpace: string | null,
): CandidateSource | null {
  const values = numericOperands(command);
  if (!values) return null;

  let kind: CandidateKind | null = null;
  if (command.operator === 'RG' && values.length === 3) {
    kind = classifyRgb(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  } else if (command.operator === 'K' && values.length === 4) {
    kind = classifyCmyk(
      values[0] ?? 0,
      values[1] ?? 0,
      values[2] ?? 0,
      values[3] ?? 0,
    );
  } else if (['SC', 'SCN'].includes(command.operator)) {
    if (colorSpace === 'DeviceRGB' && values.length === 3) {
      kind = classifyRgb(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    }
    if (colorSpace === 'DeviceCMYK' && values.length === 4) {
      kind = classifyCmyk(
        values[0] ?? 0,
        values[1] ?? 0,
        values[2] ?? 0,
        values[3] ?? 0,
      );
    }
  }

  return kind ? { commandIndex, kind } : null;
}

function colorSpaceName(command: Command): string | null {
  const name = command.operands.at(-1)?.value;
  return name?.startsWith('/') ? name.slice(1) : null;
}

export function analyzeContentStream(source: string): ContentAnalysis {
  const commands = tokenizeCommands(source);
  const candidateCommands = new Map<number, CandidateKind>();
  const counts: CandidateCounts = { contour: 0, perf: 0 };
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    candidate: null,
    strokeColorSpace: 'DeviceGray',
  };

  commands.forEach((command, commandIndex) => {
    if (command.operator === 'q') {
      stack.push({ ...state });
      return;
    }

    if (command.operator === 'Q') {
      state = stack.pop() ?? {
        candidate: null,
        strokeColorSpace: 'DeviceGray',
      };
      return;
    }

    if (command.operator === 'CS') {
      state.strokeColorSpace = colorSpaceName(command);
      state.candidate = null;
      return;
    }

    if (command.operator === 'RG') {
      state.strokeColorSpace = 'DeviceRGB';
      state.candidate = candidateForColorCommand(
        command,
        commandIndex,
        state.strokeColorSpace,
      );
      return;
    }

    if (command.operator === 'K') {
      state.strokeColorSpace = 'DeviceCMYK';
      state.candidate = candidateForColorCommand(
        command,
        commandIndex,
        state.strokeColorSpace,
      );
      return;
    }

    if (command.operator === 'G') {
      state.strokeColorSpace = 'DeviceGray';
      state.candidate = null;
      return;
    }

    if (['SC', 'SCN'].includes(command.operator)) {
      state.candidate = candidateForColorCommand(
        command,
        commandIndex,
        state.strokeColorSpace,
      );
      return;
    }

    if (STROKING_OPERATORS.has(command.operator) && state.candidate) {
      candidateCommands.set(
        state.candidate.commandIndex,
        state.candidate.kind,
      );
      counts[state.candidate.kind] += 1;
    }
  });

  return {
    candidateCommands,
    commands,
    counts,
    source,
  };
}

export function rewriteContentStream(
  analysis: ContentAnalysis,
  mode: ConversionMode,
  resourceNames: SpotResourceNames,
): string {
  const replacements = [...analysis.candidateCommands.entries()].map(
    ([commandIndex, detectedKind]) => {
      const command = analysis.commands[commandIndex];
      if (!command) {
        throw new Error('A detected PDF command could not be rewritten.');
      }

      const outputKind = mode === 'auto' ? detectedKind : mode;
      const resourceName = resourceNames[outputKind];
      return {
        end: command.end,
        replacement: `/${resourceName} CS 1 SCN`,
        start: command.start,
      };
    },
  );

  replacements.sort((left, right) => right.start - left.start);

  return replacements.reduce(
    (result, replacement) =>
      `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`,
    analysis.source,
  );
}
