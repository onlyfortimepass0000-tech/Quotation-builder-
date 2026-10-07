import type { VariableField } from "@/lib/template-schema";

/**
 * Sample values for every variable field, used only to render the
 * review-screen preview PDF (never stored, never a real quote). Lets the
 * reviewer see roughly what a generated quote will look like without
 * typing anything in first.
 */
export function placeholderFieldValues(fields: VariableField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f.type) {
      case "number":
        values[f.key] = 2;
        break;
      case "currency":
        values[f.key] = 1000;
        break;
      case "date":
        values[f.key] = new Date().toISOString().slice(0, 10);
        break;
      case "textarea":
        values[f.key] = `Sample ${f.label.toLowerCase()} text.`;
        break;
      case "line_items": {
        const row: Record<string, string | number> = {};
        const qtyCol = f.columns?.find((c) => /qty|quantity/i.test(c.key));
        const rateCol = f.columns?.find((c) => /rate|price/i.test(c.key));
        const amountCol = f.columns?.find((c) => /amount|total/i.test(c.key));
        for (const c of f.columns ?? []) {
          if (c === qtyCol) row[c.key] = 2;
          else if (c === rateCol) row[c.key] = 500;
          else if (c === amountCol) row[c.key] = qtyCol && rateCol ? 2 * 500 : 500;
          else if (c.type === "number") row[c.key] = 2;
          else if (c.type === "currency") row[c.key] = 500;
          else row[c.key] = `Sample ${c.label.toLowerCase()}`;
        }
        values[f.key] = [row];
        break;
      }
      default:
        values[f.key] = `Sample ${f.label}`;
    }
  }
  return values;
}
