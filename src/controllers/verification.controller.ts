import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { extractTextFromImage } from "../services/ai-verification.service.js";

export const verifyImageHandler: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, "No image file provided");
  }

  try {
    const result = await extractTextFromImage(req.file.buffer);
    
    res.json({
      message: "Image OCR extraction successful",
      data: result,
    });
  } catch (error) {
    throw new HttpError(500, `Failed to process image: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
