// Shell metacharacters that must be rejected in allowlist mode.
// These allow chaining or injection of additional commands.
const SHELL_METACHAR_RE = /[;&|`$<>\n\\]/;

/**
 * Parse a simple command string into tokens without a shell.
 * Handles single- and double-quoted arguments.
 * Returns null if the command contains unquoted shell metacharacters.
 */
export function tokenizeCommand(command: string): string[] | null {
  if (SHELL_METACHAR_RE.test(command)) {
    return null;
  }
  const tokens: string[] = [];
  let current = "";
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      // Single-quoted: no escape processing
      i++;
      while (i < command.length && command[i] !== "'") {
        current += command[i++];
      }
      if (i >= command.length) return null; // unterminated quote
      i++; // skip closing quote
    } else if (ch === '"') {
      // Double-quoted: only backslash-escape is processed
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\") {
          i++;
          if (i < command.length) current += command[i++];
        } else {
          current += command[i++];
        }
      }
      if (i >= command.length) return null; // unterminated quote
      i++; // skip closing quote
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Check whether a command is permitted under the given allowlist.
 *
 * The command is tokenized (without a shell) and its first token must exactly
 * match the first token of one of the allowlist entries.  Commands that contain
 * shell metacharacters (;&|`$<>\n\) are always rejected because they cannot be
 * executed safely without a shell.
 */
export function isCommandAllowed(command: string, commandAllowlist: string[]): boolean {
  const tokens = tokenizeCommand(command.trim());
  if (tokens === null || tokens.length === 0) return false;
  const first = tokens[0];
  return commandAllowlist.some((pattern) => {
    // Extract first token from the allowlist entry so that "git status" and "git" are equivalent.
    const entryTokens = tokenizeCommand(pattern.trim());
    return entryTokens !== null && entryTokens.length > 0 && first === entryTokens[0];
  });
}
