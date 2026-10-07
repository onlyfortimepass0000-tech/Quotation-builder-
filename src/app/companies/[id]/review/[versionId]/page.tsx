import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { companies, templateVersions } from "@/db/schema";
import ReviewPanel from "./review-panel";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: PageProps<"/companies/[id]/review/[versionId]">) {
  const { id, versionId } = await params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) notFound();

  const [version] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.id, versionId), eq(templateVersions.companyId, id)));
  if (!version) notFound();

  const hasExtractedAsset =
    (version.assets?.logoR2Key && version.assets.logoR2Key !== company.logoR2Key) ||
    (version.assets?.signatureR2Key && version.assets.signatureR2Key !== company.signatureR2Key);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/companies/${id}`} className="text-xs text-neutral-400 hover:text-neutral-600">
          ← {company.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">
          Review template v{version.versionNumber}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Status: <span className="font-medium">{version.status.replace("_", " ")}</span>
        </p>
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="p-4 border-b border-neutral-200">
          <h2 className="font-medium">Template preview</h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Placeholder values shown below — this is what a generated quote will actually look
            like.
          </p>
          {hasExtractedAsset && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-2">
              Logo/signature below were auto-detected from your upload — they&apos;re a best
              effort, not pixel-perfect. If either looks wrong, upload the correct image under{" "}
              <strong>Branding</strong> on the dashboard; it&apos;ll take over immediately, no
              need to re-upload or re-analyze anything.
            </p>
          )}
        </div>
        <iframe
          src={`/api/companies/${id}/template-versions/${versionId}/preview`}
          title="Template preview"
          className="w-full h-[720px]"
        />
      </section>

      <ReviewPanel
        companyId={id}
        versionId={versionId}
        status={version.status}
        initialFields={version.variableFields}
        initialPricingLogic={version.pricingLogic}
      />
    </div>
  );
}
