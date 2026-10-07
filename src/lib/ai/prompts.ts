import { LAYOUT_SLOTS, PRICING_PRESETS, MAX_VARIABLE_FIELDS } from "@/lib/template-schema";
import type { ExtractionResult } from "@/lib/ai/types";
import type { StageBResult } from "@/lib/template-schema";

export const EXTRACTION_PROMPT = `You are looking at one page of a business quotation/estimate document, rendered as an image.

Transcribe ALL visible text exactly as it appears, preserving line breaks and left-to-right reading order top to bottom. Then, on a new line starting with "LAYOUT:", write ONE short line (max 25 words) listing which of these are present: logo, company info block, items table, signature area, stamp, QR code.

Do not summarize or omit any text, including small print, terms, and boilerplate. Do not add commentary.`;

export const STAGE_B_SYSTEM_PROMPT = `You analyze OCR transcriptions of a company's past quotation/estimate PDFs to learn a reusable template: what is FIXED across every quote from this company (logo, boilerplate, terms, signature block) versus what VARIES between quotes (client name, item description, amounts, etc).

Output ONLY a single COMPACT JSON object (no whitespace padding, no markdown fences, no commentary). Every token you write costs the user waiting time, so omit anything optional — never write empty strings, "notes", or a "summary". Shape:

{"slots":[{"slot":"<one of: ${LAYOUT_SLOTS.join(", ")}>","kind":"static"|"variable"|"mixed","staticText":"<fixed text, only if kind is static or mixed and there is text>"}],
"variableFields":[{"key":"<camelCase>","label":"<human label>","type":"text"|"textarea"|"number"|"currency"|"date"|"line_items","slot":"<slot name>","confidence":0.0-1.0,"columns":[{"key":"..","label":"..","type":"text"|"number"|"currency"}]}],
"pricingLogic":{"detected":true|false,"presetId":"<one of: ${PRICING_PRESETS.map((p) => p.id).join(", ")}>"}}

List ONLY the slots that are actually present on the page in "slots" — omit absent ones entirely. "columns" only for line_items fields.

Pricing preset guide — pick the "presetId" that matches what you see across the samples, don't invent a new one:
${PRICING_PRESETS.map((p) => `- "${p.id}": ${p.description}`).join("\n")}
If you can't tell, default to "qty_rate" (by far the most common for itemized quotes).

Hard rules:
- "slots" contains one entry per slot that exists on the page; leave out slots the template doesn't use.
- TARGET 3-4 "variableFields". ${MAX_VARIABLE_FIELDS} is a hard technical ceiling, not something to aim for — treat it the same as if the limit were still 4. A human reviewer can add more afterward with a button if their business genuinely needs it, so your job is to find the SMALLEST set that covers what changes between quotes, not to be thorough. When in doubt, a field is FIXED (kind: "static"), not variable — that especially includes terms & conditions, the signature line, and boilerplate notes, which are almost always identical wording every time even though the *slot* is called "terms"/"signature". Do not create a variable field just because a slot theoretically could vary; only do it when the samples actually show it varying.
- Only use "columns" when a field's type is "line_items".
- If only one sample was provided, you cannot compare across samples — default to the obvious minimum (typically: who it's for, what's being quoted, the price/quantity inputs) and lower confidence accordingly (below 0.6), rather than inventing extra fields "to be thorough."
- If multiple samples were provided, compare them: anything identical across all samples is FIXED (kind: "static"), anything that differs is VARIABLE.
- If a prior approved template is given as context, REFINE and EXTEND it rather than starting over: keep field keys stable when they still apply, only add/change what the new sample evidence supports — and don't grow the field count just because you can.
- For "terms" specifically: copy the FULL text verbatim into "staticText", every line, exactly as transcribed — do not shorten, summarize, or paraphrase it. It is very often multiple lines or bullet points; that's expected, include all of them. Truncating this is a known bug reviewers should never see again.
- Include the "logo" and "signature" slots only when the transcription/layout description actually indicates one is there (an image/graphic block, a signature line, an "Authorized Signatory" area, etc). Don't assume every quotation has both.`;

export function buildStageBUserPrompt(
  samples: ExtractionResult[],
  priorTemplate?: StageBResult
): string {
  const parts: string[] = [];
  parts.push(`${samples.length} sample quotation(s) were OCR'd. Here is each one:`);
  samples.forEach((s, i) => {
    parts.push(`\n--- SAMPLE ${i + 1} (${s.layoutHints.description}) ---\n${s.rawText}`);
  });
  if (priorTemplate) {
    parts.push(
      `\n--- PRIOR APPROVED TEMPLATE (refine/extend this, don't discard it) ---\n${JSON.stringify(
        priorTemplate,
        null,
        2
      )}`
    );
  }
  return parts.join("\n");
}
