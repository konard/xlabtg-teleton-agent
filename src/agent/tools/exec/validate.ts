// Conservative allowlist for individual package / service-name tokens that are
// interpolated into exec commands. These tokens are spawned via an argv array
// without a shell, but we still reject anything outside a safe character set so
// that no shell metacharacter can ever reach a misconfigured downstream caller.
//
// Allowed characters cover the realistic needs of apt/pip/npm/docker package
// references and systemd unit names:
//   - letters, digits
//   - "." version separators (e.g. "flask==2.0.1")
//   - "_" "-" "+" common in Debian/npm package names (e.g. "g++", "libssl-dev")
//   - "@" npm scopes and systemd template units (e.g. "@scope/pkg", "foo@bar")
//   - "/" npm scopes and docker registry paths (e.g. "@scope/pkg", "reg.io/img")
//   - ":" docker tags (e.g. "nginx:latest")
//   - "=" pip version specifiers (e.g. "flask==2.0")
const SAFE_TOKEN_RE = /^[A-Za-z0-9._@/:=+-]+$/;

/** Returns true when a single token is safe to pass as an argv element. */
export function isSafeArgToken(token: string): boolean {
  return token.length > 0 && SAFE_TOKEN_RE.test(token);
}

/**
 * Split a whitespace-separated list into tokens and validate each one.
 * Returns the token array, or the first offending token (as `{ invalid }`)
 * when any token contains disallowed characters or the list is empty.
 */
export function parseSafeTokenList(raw: string): { tokens: string[] } | { invalid: string } {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { invalid: "" };
  }
  for (const token of tokens) {
    if (!isSafeArgToken(token)) {
      return { invalid: token };
    }
  }
  return { tokens };
}
