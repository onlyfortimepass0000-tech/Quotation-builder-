CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"active_template_version_id" text,
	"logo_r2_key" text,
	"signature_r2_key" text
);
--> statement-breakpoint
CREATE TABLE "generated_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"field_values" jsonb NOT NULL,
	"pdf_r2_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"based_on_version_id" text,
	"extracted_layout" jsonb NOT NULL,
	"variable_fields" jsonb NOT NULL,
	"pricing_logic" jsonb,
	"assets" jsonb,
	"raw_extraction" jsonb,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "uploaded_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"used_in_analysis_version_id" text
);
--> statement-breakpoint
ALTER TABLE "generated_quotes" ADD CONSTRAINT "generated_quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_quotes" ADD CONSTRAINT "generated_quotes_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_samples" ADD CONSTRAINT "uploaded_samples_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;