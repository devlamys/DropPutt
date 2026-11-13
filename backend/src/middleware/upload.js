// Multer (memory storage) with MIME and size limits (SPEC §37.4).

import multer from "multer";
import { validationError } from "../utils/response.js";
import { AUDIO_MIME_TYPES, IMAGE_MIME_TYPES } from "../utils/storage.js";

function uploader({ field, mimeTypes, maxBytes }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 30 },
    fileFilter: (req, file, callback) => {
      const mimetype = file.mimetype.split(";")[0].trim();
      if (mimeTypes.includes(mimetype)) return callback(null, true);
      callback(
        validationError("Upload rejected", [
          { field, issue: `unsupported file type ${mimetype}` },
        ])
      );
    },
  }).single(field);
}

/** multipart field `bill_image` — JPEG / PNG / WebP up to 5 MB. */
export const billImageUpload = uploader({
  field: "bill_image",
  mimeTypes: IMAGE_MIME_TYPES,
  maxBytes: 5 * 1024 * 1024,
});

/** multipart field `voice` — audio up to 10 MB. */
export const voiceUpload = uploader({
  field: "voice",
  mimeTypes: AUDIO_MIME_TYPES,
  maxBytes: 10 * 1024 * 1024,
});

/** multipart field `gate_photo` — JPEG / PNG / WebP up to 5 MB. */
export const gatePhotoUpload = uploader({
  field: "gate_photo",
  mimeTypes: IMAGE_MIME_TYPES,
  maxBytes: 5 * 1024 * 1024,
});

/**
 * Customer request media: multipart field `photo` (a handwritten list or a
 * prescription: JPEG / PNG / WebP) and `voice` (audio note). Each field has
 * its own type check; the route enforces the 5 MB photo limit.
 */
export const customRequestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 30 },
  fileFilter: (req, file, callback) => {
    const mimetype = file.mimetype.split(";")[0].trim();
    const allowed = file.fieldname === "photo" ? IMAGE_MIME_TYPES : file.fieldname === "voice" ? AUDIO_MIME_TYPES : [];
    if (allowed.includes(mimetype)) return callback(null, true);
    callback(
      validationError("Upload rejected", [
        { field: file.fieldname, issue: `unsupported file type ${mimetype}` },
      ])
    );
  },
}).fields([
  { name: "photo", maxCount: 1 },
  { name: "voice", maxCount: 1 },
]);
