export function safeParseJsonFromModel(text: string) {
  // 1) slice first {...} block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response contains no JSON object');
  }

  let jsonSlice = text.slice(start, end + 1).trim();

  // 2) remove ``` fences
  if (jsonSlice.startsWith('```')) {
    const fenceMatch = jsonSlice.match(/```json?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) jsonSlice = fenceMatch[1].trim();
  }

  // 3) First parse attempt
  try {
    return JSON.parse(jsonSlice);
  } catch (e1) {
    // continue
  }

  const looksDoubleEscaped =
    (jsonSlice.includes('\\"') || jsonSlice.includes('\\n') || jsonSlice.includes('\\t')) &&
    (jsonSlice.startsWith('"{') || jsonSlice.startsWith('{\\n') || jsonSlice.includes('\\"answer\\"'));

  if (looksDoubleEscaped) {
    try {
      const asJsonString = jsonSlice.startsWith('"') ? jsonSlice : `"${jsonSlice.replace(/"/g, '\\"')}"`;
      const unescaped = JSON.parse(asJsonString);
      if (typeof unescaped === 'string') {
        try {
          return JSON.parse(unescaped);
        } catch {
          // fall through to cleaner using unescaped string
          jsonSlice = unescaped;
        }
      }
    } catch {
      // ignore and proceed
    }
  }

  let cleaned = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonSlice.length; i++) {
    const ch = jsonSlice[i]!;
    const code = ch.charCodeAt(0);

    if (escape) {
      // keep escaped char as-is
      cleaned += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      cleaned += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      cleaned += ch;
      continue;
    }

    if (inString) {
      // Escape raw control characters inside string values
      if (ch === '\n') {
        cleaned += '\\n';
        continue;
      }
      if (ch === '\r') {
        cleaned += '\\r';
        continue;
      }
      if (ch === '\t') {
        cleaned += '\\t';
        continue;
      }
      // Any other control char < 0x20 must be escaped for JSON
      if (code < 0x20) {
        cleaned += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }

    cleaned += ch;
  }

  cleaned = cleaned.replace(/}\s*{/g, '},\n{');

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt to repair truncated JSON - fixes AUTO-RFP-2A
    const repaired = attemptTruncationRepair(cleaned);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to error
      }
    }
    console.error('Failed JSON (original):', jsonSlice);
    console.error('Failed JSON (cleaned):', cleaned);
    throw err;
  }
}

/**
 * Attempts to repair JSON that was truncated (e.g., from max_tokens cutoff).
 * Returns the repaired string or null if repair not possible.
 */
function attemptTruncationRepair(json: string): string | null {
  // Count open brackets/braces
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of json) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  // If we're in a string, try to close it
  if (inString) {
    json += '"';
    inString = false;
  }

  // Remove trailing comma if present
  json = json.replace(/,\s*$/, '');

  // Close any unclosed brackets/braces
  let repaired = json;
  while (openBrackets > 0) {
    repaired += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += '}';
    openBraces--;
  }

  return repaired !== json ? repaired : null;
}