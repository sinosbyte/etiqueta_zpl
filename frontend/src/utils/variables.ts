// Dynamic-variable placeholders in ZPL look like {{name}}, where name matches
// the same character class the parser uses to detect them ([A-Za-z0-9_]).
const VAR_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

// Distinct variable names found in the ZPL, in first-seen order.
export function extractVariables(zpl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of zpl.matchAll(VAR_RE)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// Text split into fixed parts and {{name}} placeholders, in order.
// "CONTÉM: {{QTD}} PEÇAS" -> [fixed "CONTÉM: ", variable "QTD", fixed " PEÇAS"]
export function splitVariables(text: string): { text: string; variable?: string }[] {
  const parts: { text: string; variable?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], variable: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// Replace every {{name}} with values[name]. Falls back to the variable name
// itself when no value is supplied, so a placeholder is never left in output.
export function substituteVariables(zpl: string, values: Record<string, string>): string {
  return zpl.replace(VAR_RE, (_match, name: string) => {
    const v = values[name];
    return v !== undefined && v !== '' ? v : name;
  });
}
