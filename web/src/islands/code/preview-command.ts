// Commands are passed as argv, never evaluated by a shell. Preserve quoted arguments.
export function parsePreviewCommand(value: string): string[] {
  const args: string[] = [];
  let token = "",
    quote = "",
    started = false;
  for (const char of value.trim()) {
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(token);
        token = "";
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) throw new Error("Close the quotation mark in the command.");
  if (started) args.push(token);
  return args;
}
export const formatCommand = (args?: string[]) =>
  args
    ?.map((arg) =>
      /^[a-zA-Z0-9_./:=@+-]+$/.test(arg) ? arg : "'" + arg.replaceAll("'", "'\"'\"'") + "'",
    )
    .join(" ") || "";

/** `a && b` → [argvA, argvB]: steps run one after another, the next only when the previous one succeeds. */
export function parsePreviewSteps(value: string): string[][] {
  const steps: string[][] = [];
  let current = "",
    quote = "";
  const push = () => {
    const argv = parsePreviewCommand(current);
    if (!argv.length) throw new Error("Add a command on both sides of &&.");
    steps.push(argv);
    current = "";
  };
  const text = value.trim();
  if (!text) return [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = "";
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "&" && text[i + 1] === "&") {
      push();
      i++;
    } else current += char;
  }
  push();
  return steps;
}
export const formatSteps = (steps?: string[][] | null) =>
  (steps || []).map(formatCommand).filter(Boolean).join(" && ");
