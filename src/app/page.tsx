import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import SetupCompanyForm from "./setup-company-form";

export const dynamic = "force-dynamic";

/**
 * Single-company app: "/" never shows a list or switcher. If the company
 * already exists it goes straight to its dashboard; otherwise it's a
 * one-time setup step. (The DB schema stays multi-tenant under the hood —
 * every query is still scoped by companyId — so this is purely a UX
 * decision, not a data-model one.)
 */
export default async function HomePage() {
  const db = await getDb();
  const [company] = await db.select().from(companies).limit(1);

  if (company) {
    redirect(`/companies/${company.id}`);
  }

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h1 className="text-2xl font-semibold">Set up your company</h1>
        <p className="text-sm text-neutral-500 mt-1">
          One-time setup. You can rename this later from the dashboard once you know the final
          name.
        </p>
      </div>
      <SetupCompanyForm />
    </div>
  );
}
