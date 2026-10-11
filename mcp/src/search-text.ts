import { ToolError } from "./errors";

/** The longest search text (`q`) the API's list endpoints take. */
export const MAX_SEARCH_LENGTH = 100;

export interface SearchText {
  /** The reference without the blanks around it. */
  text: string;
  /** What to send as `q`: `text`, cut to what the API takes. */
  q: string;
  /**
   * `text` was longer than the API takes, so `q` is only its start and the hits are candidates:
   * keep those that match `text` as a whole and nothing else (a loose match could be another record).
   */
  cut: boolean;
}

/**
 * A reference to a record (an id, a name, a plate) as the search text of a list call. A blank one
 * is refused with a message saying what to give (`give`, for example "give the vehicle's id, name or
 * plate"), as it would otherwise match everything or fail in the API with a message about `q`.
 */
export function searchText(give: string, ref: string): SearchText {
  const text = ref.trim();
  if (text === "") {
    throw new ToolError("invalid_request", `Nothing to look for: ${give}.`);
  }
  return {
    text,
    q: text.slice(0, MAX_SEARCH_LENGTH),
    cut: text.length > MAX_SEARCH_LENGTH,
  };
}
