// Parses and re-serializes unified diffs, fixing the drift that shows up
// once a diff has been hand-edited, copy-pasted through a chat window, or
// round-tripped through something that mangles line endings and trailing
// whitespace.

export class DiffFormatError extends Error {}

export interface Hunk {
  oldStart: number;
  newStart: number;
  /** Trailing text on the @@ line, e.g. " function greet() {" */
  headerSuffix: string;
  /** Raw hunk body lines, each starting with ' ', '+', '-', or '\'. */
  lines: string[];
}

export interface GitFileHeader {
  /** The "a/..." path exactly as written after `diff --git`. */
  oldPath: string;
  /** The "b/..." path exactly as written after `diff --git`. */
  newPath: string;
  /** `index`/mode-change lines that followed, preserved verbatim. */
  extendedLines: string[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
  /** Present when the entry began with a `diff --git` line. */
  gitHeader?: GitFileHeader;
  /**
   * False for entries with no `---`/`+++` pair at all: a pure file-mode
   * change carries only a `diff --git` line and mode lines. Defaults to
   * true, so plain (non-git) diffs don't need to set it.
   */
  hasPathHeaders?: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const GIT_DIFF_HEADER = /^diff --git (\S+) (\S+)$/;
const OLD_MODE = /^old mode \d+$/;
const NEW_MODE = /^new mode \d+$/;
const NEW_FILE_MODE = /^new file mode \d+$/;
const DELETED_FILE_MODE = /^deleted file mode \d+$/;
const INDEX_LINE = /^index [0-9a-fA-F]+\.\.[0-9a-fA-F]+(?: \d+)?$/;

function isExtendedHeaderLine(line: string): boolean {
  return (
    OLD_MODE.test(line) ||
    NEW_MODE.test(line) ||
    NEW_FILE_MODE.test(line) ||
    DELETED_FILE_MODE.test(line) ||
    INDEX_LINE.test(line)
  );
}

function stripLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parsePathHeader(line: string, prefixLength: number): string {
  const rest = line.slice(prefixLength);
  // `diff -u` appends a tab-separated timestamp after the path; drop it.
  const tabIndex = rest.indexOf("\t");
  const path = tabIndex === -1 ? rest : rest.slice(0, tabIndex);
  return path.trimEnd();
}

function looksLikeFileHeader(lines: string[], index: number): boolean {
  return (
    lines[index] !== undefined &&
    lines[index].startsWith("--- ") &&
    lines[index + 1] !== undefined &&
    lines[index + 1].startsWith("+++ ")
  );
}

export function parseDiff(text: string): FileDiff[] {
  const lines = stripLineEndings(text).split("\n");
  const files: FileDiff[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i] === "") {
      i++;
      continue;
    }

    let gitHeader: GitFileHeader | undefined;
    if (lines[i].startsWith("diff --git ")) {
      const match = GIT_DIFF_HEADER.exec(lines[i]);
      if (!match) {
        throw new DiffFormatError(`malformed diff --git header: ${lines[i]}`);
      }
      i++;
      const extendedLines: string[] = [];
      while (i < lines.length && isExtendedHeaderLine(lines[i])) {
        extendedLines.push(lines[i]);
        i++;
      }
      gitHeader = { oldPath: match[1], newPath: match[2], extendedLines };
    }

    if (gitHeader && !(i < lines.length && lines[i].startsWith("--- "))) {
      // A pure file-mode or index change: no `---`/`+++` pair, no hunks.
      files.push({
        oldPath: gitHeader.oldPath,
        newPath: gitHeader.newPath,
        hunks: [],
        gitHeader,
        hasPathHeaders: false,
      });
      continue;
    }

    if (!lines[i].startsWith("--- ")) {
      throw new DiffFormatError(
        `expected a "--- " file header, found: ${JSON.stringify(lines[i])}`,
      );
    }
    const oldPath = parsePathHeader(lines[i], 4);
    i++;
    if (i >= lines.length || !lines[i].startsWith("+++ ")) {
      throw new DiffFormatError(
        `expected a "+++ " file header after "--- ${oldPath}"`,
      );
    }
    const newPath = parsePathHeader(lines[i], 4);
    i++;

    const hunks: Hunk[] = [];
    while (i < lines.length && lines[i].startsWith("@@")) {
      const match = HUNK_HEADER.exec(lines[i]);
      if (!match) {
        throw new DiffFormatError(`malformed hunk header: ${lines[i]}`);
      }
      const oldStart = Number(match[1]);
      const newStart = Number(match[2]);
      const headerSuffix = match[3];
      i++;

      const body: string[] = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("@@") && HUNK_HEADER.test(line)) break;
        if (looksLikeFileHeader(lines, i)) break;
        if (line === "") {
          // A blank context line that lost its leading space somewhere
          // along the way. Restore it rather than treating it as noise.
          body.push(" ");
          i++;
          continue;
        }
        const marker = line[0];
        if (marker === " " || marker === "+" || marker === "-" || marker === "\\") {
          body.push(line);
          i++;
          continue;
        }
        break;
      }

      hunks.push({ oldStart, newStart, headerSuffix, lines: body });
    }

    files.push({ oldPath, newPath, hunks, gitHeader, hasPathHeaders: true });
  }

  return files;
}

function countLines(body: string[]): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;
  for (const line of body) {
    const marker = line[0];
    if (marker === " ") {
      oldCount++;
      newCount++;
    } else if (marker === "-") {
      oldCount++;
    } else if (marker === "+") {
      newCount++;
    }
    // '\' (no newline at end of file) lines don't count either way.
  }
  return { oldCount, newCount };
}

// GNU diff omits the ",count" suffix when count is exactly 1.
function formatRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export function serializeDiff(files: FileDiff[]): string {
  const out: string[] = [];
  for (const file of files) {
    if (file.gitHeader) {
      out.push(`diff --git ${file.gitHeader.oldPath} ${file.gitHeader.newPath}`);
      out.push(...file.gitHeader.extendedLines);
    }
    if (file.hasPathHeaders !== false) {
      out.push(`--- ${file.oldPath}`);
      out.push(`+++ ${file.newPath}`);
    }
    for (const hunk of file.hunks) {
      const { oldCount, newCount } = countLines(hunk.lines);
      out.push(
        `@@ -${formatRange(hunk.oldStart, oldCount)} +${formatRange(hunk.newStart, newCount)} @@${hunk.headerSuffix}`,
      );
      out.push(...hunk.lines);
    }
  }
  return out.join("\n") + "\n";
}

export function normalizeDiff(text: string): string {
  return serializeDiff(parseDiff(text));
}
