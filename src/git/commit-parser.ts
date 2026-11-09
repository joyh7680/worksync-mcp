export interface Commit {
  hash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
}
export function parseCommits(raw: string): Commit[] {
  const parts = raw.split('\0');
  const commits: Commit[] = [];
  for (let i = 0; i + 5 < parts.length; i += 6) {
    const [hash, authorName, authorEmail, authoredAt, committedAt, subject] = parts.slice(i, i + 6);
    if (hash.trim())
      commits.push({
        hash: hash.trim(),
        authorName,
        authorEmail,
        authoredAt,
        committedAt,
        subject,
      });
  }
  return commits;
}
export const sensitivePath = (p: string) =>
  /(^|\/)(\.env[^/]*|\.git|\.ssh|\.aws|\.azure|\.kube|\.npmrc|\.netrc|\.pypirc|\.git-credentials|node_modules|vendor|dist|build|coverage|secrets?(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|id_(?:rsa|ed25519)(?:\.[^/]*)?)(\/|$)|(?:\.pem|\.key|\.p12|\.pfx|\.keystore|\.zip|\.mp4|\.pdf|\.png|\.jpg|package-lock\.json|pnpm-lock\.yaml)$/i.test(
    p,
  );
export const redact = (text: string) =>
  text
    .replace(/(?:secret_|ntn_|ghp_|sk-)[A-Za-z0-9_\-]{10,}/g, '[REDACTED]')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
