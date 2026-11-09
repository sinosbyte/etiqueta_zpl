// Checks that a ZPL can be captured and printed by the SAP side, with the same rules
// as the ABAP classes (ZCLSB_ETIQ_DESIGN and ZCLSB_ETIQ_IMPRESSAO):
//  - the capture splits the ZPL at line breaks (CR LF counts as one) and refuses a
//    line longer than 255 characters (the LINHA_CODIGO field is CHAR 255);
//  - the print replaces each {{NAME}} (letters, digits and _) and refuses a line that
//    still has "{{" or "}}" after that ("marcador mal formado").

export const SAP_MAX_LINE = 255;

// The same pattern the printing class uses for a variable
const VARIABLE = /\{\{[A-Za-z0-9_]+\}\}/g;

export type SapIssueKind = 'longLine' | 'badMarker';

export interface SapIssue {
  kind: SapIssueKind;
  line: number;      // 1-based, as the Código tab numbers them
  length: number;    // characters of the line
  excerpt: string;   // start of the line, to find it
}

const EXCERPT = 48;
const excerptOf = (line: string) => (line.length > EXCERPT ? `${line.slice(0, EXCERPT)}…` : line);

/** Problems that would stop the SAP from capturing or printing this ZPL; empty when it is fine. */
export function checkSapCompat(zpl: string): SapIssue[] {
  const issues: SapIssue[] = [];
  zpl.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (line.length > SAP_MAX_LINE) {
      issues.push({ kind: 'longLine', line: i + 1, length: line.length, excerpt: excerptOf(line) });
    }
    const rest = line.replace(VARIABLE, '');
    if (rest.includes('{{') || rest.includes('}}')) {
      issues.push({ kind: 'badMarker', line: i + 1, length: line.length, excerpt: excerptOf(line) });
    }
  });
  return issues;
}
