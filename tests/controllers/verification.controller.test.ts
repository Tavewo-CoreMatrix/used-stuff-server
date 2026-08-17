import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import * as aiService from "../../src/services/ai-verification.service.js";
import * as authMiddleware from "../../src/middleware/auth.middleware.js";

// Mock the AI service to avoid processing real images
vi.mock("../../src/services/ai-verification.service.js", () => ({
  extractTextFromImage: vi.fn(),
}));

// Mock auth middleware to bypass token checking
vi.mock("../../src/middleware/auth.middleware.js", () => ({
  requireAuth: vi.fn((req, res, next) => {
    req.accountId = "user-1";
    req.accountRole = "SELLER";
    next();
  }),
}));

const app = createApp();

describe("verification.controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/verification/verify-tag", () => {
    it("returns 400 if no image is uploaded", async () => {
      const response = await request(app).post("/api/v1/verification/verify-tag");

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("No image file provided");
    });

    it("returns 200 and extracts text when image is uploaded", async () => {
      vi.mocked(aiService.extractTextFromImage).mockResolvedValue({
        text: "Growatt 5000W",
        confidence: 90,
        extractedKeywords: ["growatt", "5000W"],
      });

      // We attach a dummy buffer to simulate an image file upload
      const response = await request(app)
        .post("/api/v1/verification/verify-tag")
        .attach("image", Buffer.from("dummy-image-data"), "test.jpg");

      expect(response.status).toBe(200);
      expect(response.body.data.text).toBe("Growatt 5000W");
      expect(response.body.data.extractedKeywords).toContain("5000W");
      expect(aiService.extractTextFromImage).toHaveBeenCalled();
    });

    it("handles non-image file rejection from multer", async () => {
      const response = await request(app)
        .post("/api/v1/verification/verify-tag")
        // .txt extension and text/plain mimetype to trigger the multer fileFilter
        .attach("image", Buffer.from("text file"), { filename: "test.txt", contentType: "text/plain" });

      // multer throws an error which should be caught by express error handler
      expect(response.status).toBe(500); 
      expect(response.body.error.message).toContain("Only images are allowed");
    });
  });
});
