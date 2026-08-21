// Dispatches a decoded barcode to the most specific parser that applies.
//
// Selection leans on ZXing's own `contentType` where possible -- it reports
// "GS1" when an FNC1 sits in the first position and "ISO15434" when it sees the
// "[)>" envelope, which is more reliable than sniffing the text ourselves.

import { parseGS1 } from "./gs1.js";
import { parseAAMVA, looksLikeAAMVA } from "./aamva.js";
import { parseISO15434, looksLikeISO15434 } from "./iso15434.js";
import { parseGeneric } from "./generic.js";

/**
 * @param {{text: string, format: string, contentType: string}} result
 * @returns {{kind: string, fields: Array, warnings: string[]}}
 */
export function parse(result) {
  const { text, format, contentType } = result;

  try {
    if (contentType === "ISO15434" || looksLikeISO15434(text)) return parseISO15434(text);
    if (contentType === "GS1") return parseGS1(text);
    if (format === "PDF417" && looksLikeAAMVA(text)) return parseAAMVA(text);
    // A GS1 element string is occasionally carried without the FNC1 flag set.
    if (/^01\d{14}/.test(text) || /^00\d{18}/.test(text)) return parseGS1(text);
    return parseGeneric(text);
  } catch (err) {
    return {
      kind: "Unparsed",
      fields: [{ label: "Content", value: text }],
      warnings: [`Could not interpret the payload: ${err.message}`],
    };
  }
}
