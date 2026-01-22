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
    const ch = jsonSlice[i];
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
    console.error('Failed JSON (original):', jsonSlice);
    console.error('Failed JSON (cleaned):', cleaned);
    throw err;
  }
}