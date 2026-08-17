import { describe, expect, it, vi, beforeEach } from "vitest";
import { extractTextFromImage, preprocessImageForOCR } from "../../src/services/ai-verification.service.js";

// We mock sharp and tesseract.js to avoid actual heavy image processing during tests
vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    grayscale: vi.fn().mockReturnThis(),
    normalize: vi.fn().mockReturnThis(),
    sharpen: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("processed-image")),
  })),
}));

vi.mock("tesseract.js", () => ({
  default: {
    recognize: vi.fn().mockResolvedValue({
      data: {
        text: "Growatt 1000W Inverter 48V",
        confidence: 95,
      },
    }),
  },
}));

describe("ai-verification.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("preprocessImageForOCR", () => {
    it("returns a processed buffer", async () => {
      const buffer = Buffer.from("raw-image");
      const result = await preprocessImageForOCR(buffer);
      expect(result).toEqual(Buffer.from("processed-image"));
    });
  });

  describe("extractTextFromImage", () => {
    it("extracts text and parses keywords correctly", async () => {
      const buffer = Buffer.from("raw-image");
      const result = await extractTextFromImage(buffer);

      expect(result.text).toBe("Growatt 1000W Inverter 48V");
      expect(result.confidence).toBe(95);
      
      // Keywords expected: "Growatt" (brand), "1000W", "48V"
      expect(result.extractedKeywords).toContain("growatt");
      expect(result.extractedKeywords).toContain("1000w");
      expect(result.extractedKeywords).toContain("48v");
    });
  });
});
