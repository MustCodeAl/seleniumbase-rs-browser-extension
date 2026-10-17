// Source rules that tsc does not have. `bun run lint` applies them to every .ts file
// of src/, tests/ and scripts/.

/** A line without its string literals and its trailing comment: what is left is code. */
function codeOf(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$/, "");
}

/** `any` written as a type: after `:`, `|`, `&`, `<`, `,`, `(`, `=`, `[`, `=>`, `as`, `extends` or `keyof`. */
const ANY_AS_A_TYPE = /(?:[:|&<,(=\[]|\bas|\bextends|\bkeyof)\s*any\b/;

/** A justification: `// any: <why>` on the line, or alone on the line before it. */
const ANY_REASON = /\/\/\s*any:\s*\S/;

/**
 * The 1-based numbers of the lines of `source` that write `any` as a type without
 * saying why. `any` is for the rare place where TypeScript cannot express what is
 * known; each use carries a `// any: <why>` comment.
 */
export function unexplainedAny(source: string): number[] {
  const lines = source.split("\n");
  const found: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (!ANY_AS_A_TYPE.test(codeOf(line))) return;
    if (ANY_REASON.test(line) || ANY_REASON.test(lines[index - 1] ?? "")) return;
    found.push(index + 1);
  });
  return found;
}
