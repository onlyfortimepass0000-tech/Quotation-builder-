import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { companies, templateVersions } from "@/db/schema";
import GenerateForm from "./generate-form";

export const dynamic = "force-dynamic";

export default async function GeneratePage({ params }: PageProps<"/companies/[id]/generate">) {
  const { id } = await params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) notFound();

  if (!company.activeTemplateVersionId) {
    return (
      <div className="space-y-4">
        <Link href={`/companies/${id}`} className="text-xs text-neutral-400 hover:text-neutral-600">
          ← {company.name}
        </Link>
        <p className="text-sm text-neutral-500">
          No approved template yet. Upload sample quotations and approve a template first.
        </p>
      </div>
    );
  }

  const [version] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, company.activeTemplateVersionId));
  if (!version) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/companies/${id}`} className="text-xs text-neutral-400 hover:text-neutral-600">
          ← {company.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Generate a quote</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Using template v{version.versionNumber} — no AI call, generation is instant.
        </p>
      </div>
      <GenerateForm companyId={id} fields={version.variableFields} />
    </div>
  );
}
