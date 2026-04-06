// Pure helper functions for the experiments config UI.
// No React, no DB, no server-only — safe to import from tests without any setup.

/**
 * Sanitize a config name for use in a Content-Disposition filename.
 * - Replaces spaces with hyphens.
 * - Strips characters hostile to Content-Disposition (slashes, backslashes, quotes, dots except last).
 * - Caps length at 100 characters.
 * - Returns 'config' if the result is empty.
 */
export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/[/\\".]/g, '') // strip hostile characters
    .slice(0, 100);
  return sanitized || 'config';
}

/**
 * Construct the export filename for a config JSON download.
 * Format: <sanitized-name>-<hash8>.json
 */
export function exportFilename(name: string, contentHash: string): string {
  return `${sanitizeFilename(name)}-${contentHash.slice(0, 8)}.json`;
}

/**
 * Merge RHF field errors (from formState.errors, keyed by dot-path string)
 * with server-side field errors (from Server Action response, keyed by dot-path string).
 * Server errors take precedence over client errors on the same path.
 *
 * Returns a flat Record<string, string> keyed by dot-path, value = first error message.
 */
export function mergeFieldErrors(
  clientErrors: Record<string, string>,
  serverErrors: Record<string, string[]>,
): Record<string, string> {
  const merged: Record<string, string> = { ...clientErrors };
  for (const [path, messages] of Object.entries(serverErrors)) {
    if (messages.length > 0) {
      merged[path] = messages[0];
    }
  }
  return merged;
}
