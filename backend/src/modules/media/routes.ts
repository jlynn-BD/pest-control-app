import { Router } from "express";
import path from "node:path";
import { generateId } from "../../lib/id";
import { storage } from "../../lib/storage";
import { asyncHandler, HttpError } from "../../middleware/error-handler";
import { requireAuth } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

mediaRouter.post(
  "/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const id = generateId();
    const ext = path.extname(req.file.originalname) || "";
    const key = `uploads/${id}${ext}`;
    await storage.save(req.file.buffer, key);
    res.status(201).json({ id, url: `/api/media/file/${key}` });
  })
);

// Wildcard file-serving route, auth-gated (never a public static dir since
// photos/signatures can contain customer PII).
mediaRouter.get(
  "/file/*",
  asyncHandler(async (req, res) => {
    const key = (req.params as unknown as { 0: string })[0];
    if (!key || key.includes("..")) throw new HttpError(400, "Invalid file key");
    const exists = await storage.exists(key);
    if (!exists) throw new HttpError(404, "File not found");
    res.sendFile(storage.getAbsolutePath(key));
  })
);
