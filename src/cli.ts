#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { normalizeDiff, DiffFormatError } from "./normalize.js";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const [inputPath] = process.argv.slice(2);
  const input = inputPath ? readFileSync(inputPath, "utf8") : readStdin();

  try {
    process.stdout.write(normalizeDiff(input));
  } catch (err) {
    const message = err instanceof DiffFormatError ? err.message : String(err);
    process.stderr.write(`difftidy: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
