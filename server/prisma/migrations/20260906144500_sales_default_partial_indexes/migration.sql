-- At most one active default Pipeline per organization.
CREATE UNIQUE INDEX "sales_pipelines_one_active_default_per_org"
  ON "sales_pipelines" ("organizationId")
  WHERE "isDefault" = true AND "archivedAt" IS NULL;

-- Price Book has no `isDefault` column, matching the frontend's own model
-- (mockPriceBookData.js resolves "the applicable price book" via a
-- specificity+priority ranking in resolvePrice(), not a boolean default
-- flag) — so there is no equivalent partial index to add here.
