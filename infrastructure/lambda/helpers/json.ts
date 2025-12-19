export function safeParseJsonFromModel(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response contains no JSON object');
  }

  let jsonSlice = text.slice(start, end + 1).trim();

  if (jsonSlice.startsWith('```')) {
    const fenceMatch = jsonSlice.match(/```json?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      jsonSlice = fenceMatch[1].trim();
    }
  }

  try {
    return JSON.parse(jsonSlice);
  } catch (primaryErr) {
    console.warn('Primary JSON.parse failed, trying cleaned version:', primaryErr);
  }

  let cleaned = '';
  let inString = false;
  let prev = '';

  for (const ch of jsonSlice) {
    if (ch === '"' && prev !== '\\') {
      inString = !inString;
      cleaned += ch;
    } else if (ch === '\n' && inString) {
      cleaned += '\\n';
    } else {
      cleaned += ch;
    }
    prev = ch;
  }

  cleaned = cleaned.replace(/}\s*{/g, '},\n{');

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed JSON (cleaned):', cleaned);
    throw err;
  }
}
