import type { YouTrackClient } from "./client.js";

/**
 * Completes YouTrack issue IDs by performing a live search.
 * The value parameter is treated as a YouTrack query prefix.
 * Returns up to 10 matching idReadable values.
 */
export function issueIdCompleter(client: YouTrackClient) {
  return async (value: string): Promise<string[]> => {
    if (!value) return [];
    try {
      const issues = await client.get<Array<{ idReadable: string }>>(
        "/issues",
        { fields: "idReadable", query: value, $top: 10 },
      );
      return issues.map(i => i.idReadable).filter(Boolean);
    } catch {
      return [];
    }
  };
}
