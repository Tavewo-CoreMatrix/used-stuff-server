import { v2 as cloudinary } from "cloudinary";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

const uploadBufferToCloudinary = (buffer: Buffer, folder: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });

export const uploadImageHandler: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, "No image file provided");
  }

  const url = await uploadBufferToCloudinary(req.file.buffer, "used-stuff/listings");

  res.status(201).json({ data: { url } });
});
