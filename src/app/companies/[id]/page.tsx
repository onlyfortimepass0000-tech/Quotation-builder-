import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { companies, templateVersions, uploadedSamples } from "@/db/schema";
import UploadForm from "./upload-form";
import CompanyNameEditor from "./company-name-editor";
import BrandingForm from "./branding-form";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  superseded: "bg-neutral-100 text-neutral-500",
  rejected: "bg-red-100 text-red-700",
};

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) notFound();

  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.companyId, id))
    .orderBy(desc(templateVersions.versionNumber));

  const samples = await db
    .select()
    .from(uploadedSamples)
    .where(eq(uploadedSamples.companyId, id))
    .orderBy(desc(uploadedSamples.uploadedAt));

  const hasApproved = Boolean(company.activeTemplateVersionId);

  return (
    <div className="space-y-8">
      <CompanyNameEditor companyId={id} name={company.name} />

      <div className="flex gap-3">
        <Link
          href={`/companies/${id}/generate`}
          className={
            "rounded-md px-4 py-2 text-sm font-medium " +
            (hasApproved
              ? "bg-neutral-900 text-white"
              : "bg-neutral-100 text-neutral-400 pointer-events-none")
          }
        >
          Generate a quote
        </Link>
        <Link
          href={`/companies/${id}/quotes`}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Quote history
        </Link>
      </div>

      <BrandingForm companyId={id} logoR2Key={company.logoR2Key} signatureR2Key={company.signatureR2Key} />

      <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
        <h2 className="font-medium">
          {samples.length === 0 ? "Teach it your quotation format" : "Teach it something new"}
        </h2>
        <p className="text-sm text-neutral-500">
          Upload 1+ real past quotation PDFs (with real sample data). We analyze the layout and
          the fields that change between quotes — nothing goes live until you review and approve
          it below.
        </p>
        <UploadForm companyId={id} hasApprovedTemplate={hasApproved} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Template versions</h2>
        {versions.length === 0 && (
          <p className="text-sm text-neutral-400">No analysis run yet.</p>
        )}
        <div className="space-y-2">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-4 py-3"
            >
              <div>
                <span className="font-medium text-sm">v{v.versionNumber}</span>
                <span className="text-xs text-neutral-400 ml-2">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs rounded-full px-2 py-0.5 ${STATUS_STYLES[v.status] ?? ""}`}
                >
                  {v.status.replace("_", " ")}
                </span>
                {v.status === "pending_review" && (
                  <Link
                    href={`/companies/${id}/review/${v.id}`}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    Review →
                  </Link>
                )}
                {v.status !== "pending_review" && (
                  <Link
                    href={`/companies/${id}/review/${v.id}`}
                    className="text-xs text-neutral-400 hover:underline"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Uploaded samples</h2>
        {samples.length === 0 && <p className="text-sm text-neutral-400">None yet.</p>}
        <ul className="text-sm text-neutral-500 space-y-1">
          {samples.map((s) => (
            <li key={s.id} className="flex justify-between">
              <span>{s.originalFilename}</span>
              <span className="text-xs text-neutral-400">
                {new Date(s.uploadedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
