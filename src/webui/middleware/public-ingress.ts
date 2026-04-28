const PUBLIC_SIGNED_API_PATHS = [
  /^\/api\/agent-network$/,
  /^\/api\/webhooks\/incoming\/[^/]+$/,
  /^\/api\/workflows\/webhook\/[^/]+$/,
];

export function isPublicSignedApiIngress(path: string): boolean {
  return PUBLIC_SIGNED_API_PATHS.some((pattern) => pattern.test(path));
}
