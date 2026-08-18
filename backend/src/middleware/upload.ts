import multer from "multer";

// Memory storage: small field-photo uploads from a mobile client, written
// to disk ourselves via the StorageAdapter so all file writes go through
// one place.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
