import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { companies, generatedQuotes } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function QuoteHistoryPage({ params }: PageProps<"/companies/[id]/quotes">) {
  const { id } = await params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) notFound();

  const quotes = await db
    .select()
    .from(generatedQuotes)
    .where(eq(generatedQuotes.companyId, id))
    .orderBy(desc(generatedQuotes.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/companies/${id}`} className="text-xs text-neutral-400 hover:text-neutral-600">
          ← {company.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Quote history</h1>
      </div>

      {quotes.length === 0 && (
        <p className="text-sm text-neutral-400">
          No quotes generated yet.{" "}
          <Link href={`/companies/${id}/generate`} className="text-blue-600 hover:underline">
            Generate one
          </Link>
          .
        </p>
      )}

      <div className="space-y-2">
        {quotes.map((q) => (
          <div
            key={q.id}
            className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-4 py-3"
          >
            <div className="text-sm">
              <div className="font-medium">Quote {q.id.slice(0, 8)}</div>
              <div className="text-xs text-neutral-400">
                {new Date(q.createdAt).toLocaleString()}
              </div>
            </div>
            <a
              href={q.pdfR2Key}
              target="_blank"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
