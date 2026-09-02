/**
 * Shared helper for parsing a JSON array (or single object) out of an LLM
 * text response that may be wrapped in markdown fences or surrounded by prose.
 * Mirrors the logic used by the extraction pipeline.
 */
export const parseJsonFromResponse = (textContent: string): unknown[] | null => {
  let jsonStr = textContent.trim();

  if (jsonStr.includes('```json')) {
    const start = jsonStr.indexOf('```json') + 7;
    const end = jsonStr.indexOf('```', start);
    jsonStr = end > start ? jsonStr.slice(start, end) : jsonStr.slice(start);
  } else if (jsonStr.includes('```')) {
    const start = jsonStr.indexOf('```') + 3;
    const end = jsonStr.indexOf('```', start);
    jsonStr = end > start ? jsonStr.slice(start, end) : jsonStr.slice(start);
  }

  const arrayStart = jsonStr.indexOf('[');
  const arrayEnd = jsonStr.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  } else {
    const objStart = jsonStr.indexOf('{');
    const objEnd = jsonStr.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      jsonStr = jsonStr.slice(objStart, objEnd + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
};
