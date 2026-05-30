/**
 * Commitlint configuration.
 *
 * Enforces the Conventional Commits specification
 * (https://www.conventionalcommits.org/) so that the automated release
 * tooling (release-please) can derive SemVer bumps and generate the
 * CHANGELOG from commit history. See CONTRIBUTING.md for the policy.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow a slightly longer header than the default 72 chars; some of our
    // scoped commits (e.g. "fix(memory): ...") need the extra room.
    'header-max-length': [2, 'always', 100],
  },
};
