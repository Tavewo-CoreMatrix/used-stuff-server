import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

// https://res.cloudinary.com/<cloud>/image/upload/v123/used-stuff/listings/abc.jpg -> used-stuff/listings/abc
const publicIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-z0-9]+(?:\?.*)?$/i);
  return match ? match[1] : null;
};

// Best-effort: a failed image delete must never block or undo an account erasure.
export const deleteCloudinaryImages = async (urls: string[]): Promise<void> => {
  const ids = urls.map(publicIdFromUrl).filter((id): id is string => !!id);
  await Promise.all(
    ids.map((id) =>
      cloudinary.uploader.destroy(id, { resource_type: "image" }).catch((error) => {
        console.warn(`[Cloudinary] Could not delete ${id}:`, error?.message ?? error);
      }),
    ),
  );
};
