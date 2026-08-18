import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";

const signatureSchema = z.object({
  signerType: z.enum(["CUSTOMER", "TECHNICIAN"]),
  signerName: z.string().min(1),
  signerContactId: z.string().optional().nullable(),
  signerUserId: z.string().optional().nullable(),
  imageBase64: z.string().min(1), // data URL or raw base64 PNG
});

// Mounted at /api/inspections/:inspectionId/signatures
export const signaturesOnInspectionRouter = Router({ mergeParams: true });
signaturesOnInspectionRouter.use(requireAuth);

signaturesOnInspectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const signatures = await prisma.signature.findMany({
      where: { inspectionId: req.params.inspectionId },
      orderBy: { createdAt: "asc" },
    });
    res.json(signatures);
  })
);

signaturesOnInspectionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = signatureSchema.parse(req.body);
    const base64Data = body.imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const signatureId = generateId();
    const key = `signatures/${req.params.inspectionId}/${signatureId}.png`;
    await storage.save(buffer, key);

    const signature = await prisma.signature.create({
      data: {
        id: signatureId,
        inspectionId: req.params.inspectionId,
        signerType: body.signerType,
        signerName: body.signerName,
        signerContactId: body.signerContactId,
        signerUserId: body.signerUserId,
        imageUrl: `/api/media/file/${key}`,
        signedAt: new Date(),
      },
    });
    res.status(201).json(signature);
  })
);
