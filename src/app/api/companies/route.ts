import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const rows = await db.select().from(companies).orderBy(desc(companies.createdAt));
  return NextResponse.json({ companies: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const db = await getDb();
  const id = nanoid();
  await db.insert(companies).values({ id, name, activeTemplateVersionId: null });
  return NextResponse.json({ company: { id, name } }, { status: 201 });
}
