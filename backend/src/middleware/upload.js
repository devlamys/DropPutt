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
