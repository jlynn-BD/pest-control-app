-- Matt: a finding shouldn't revolve around identifying a pest, and
-- evidence/entry points/risk factors become notes guidance instead of
-- structured fields (see FindingEditorForm.tsx).
ALTER TABLE "Finding" DROP CONSTRAINT "Finding_pestTypeId_fkey";

ALTER TABLE "Finding" DROP COLUMN "pestTypeId",
                      DROP COLUMN "pestTypeOther",
                      DROP COLUMN "evidenceTypes",
                      DROP COLUMN "riskFactors",
                      DROP COLUMN "entryPoints";

DROP TABLE "PestType";
