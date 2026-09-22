# difftidy

A small formatter for unified diffs. It reads a diff and rewrites it into a
canonical form: consistent line endings, hunk headers whose line counts
actually match the hunk body, and blank context lines that still have their
leading space.

## Why

Unified diffs are easy to mangle by hand. Paste one through a chat client,
edit a hunk to drop a line, or save it from a terminal that strips trailing
whitespace, and you end up with something that mostly looks right but that
`patch` or `git apply` will reject or misapply:

- a hunk header says `@@ -1,3 +1,3 @@` but three lines were added and two
  removed since the header was written
- a blank line inside a hunk is supposed to mean "unchanged empty line" but
  is missing its leading space, so it reads as the end of the hunk
- `\r\n` line endings sneak in from a Windows editor and break tools that
  split on `\n`

`difftidy` re-parses the diff structurally and re-emits it with the counts
and markers recomputed from the actual content, instead of trusting whatever
was typed in the header.

## Example

Input (`messy.diff`) — the header claims 3 old lines and 3 new lines, and the
blank line before the closing brace lost its leading space:

```diff
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,3 @@
 export function greet(name: string) {
-  return "Hello, " + name
+  return `Hello, ${name}!`

 }
```

Running it through difftidy:

```
$ node dist/cli.js < messy.diff
```

produces:

```diff
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,4 +1,4 @@
 export function greet(name: string) {
-  return "Hello, " + name
+  return `Hello, ${name}!`

 }
```

The header now reads `-1,4 +1,4` (there are four old lines and four new
lines once the blank context line is counted), and the blank line is a real
context line again — internally it's a single space; most renderers just
show it as blank.

## Usage

As a CLI, reading from stdin or a file path:

```
node dist/cli.js path/to/some.diff > clean.diff
node dist/cli.js < some.diff > clean.diff
```

As a library:

```ts
import { normalizeDiff } from "./src/index.js";

const clean = normalizeDiff(messyDiffText);
```

For lower-level access, `parseDiff` turns diff text into a `FileDiff[]`
(paths and hunks) and `serializeDiff` turns that structure back into text,
recomputing hunk header counts each time.

## Building

This project has no runtime dependencies. Compile with the TypeScript
compiler:

```
tsc
```

which reads `tsconfig.json` and writes the CLI and library to `dist/`.

## Scope right now

The parser handles one or more files, each optionally preceded by a
`diff --git a/path b/path` line and its `index`/mode-change lines, followed
by a `---`/`+++` path pair and `@@` hunks. Pure mode changes (a `diff --git`
entry with no textual diff, such as a chmod) are also recognized. Everything
in a recognized `diff --git` preamble is preserved verbatim and re-emitted
as-is; only the hunk headers underneath are recomputed.

It does not yet understand rename or copy metadata (`rename from`/
`rename to`, `copy from`/`copy to`, `similarity index`) — those pass through
as unrecognized input today. See the issues for what's planned next.

## License

MIT, see `LICENSE`.
