import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock OpenAI so the tests never send a real (billed) request.
const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));
vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: createCompletion } } };
  }),
}));

import { extractTextFromImage } from "../../src/services/ai-verification.service.js";

const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe("ai-verification.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractTextFromImage", () => {
    it("parses the extracted specs", async () => {
      createCompletion.mockResolvedValue(reply(JSON.stringify({
        brand: "Growatt",
        model: null,
        wattage: 1000,
        voltage: 48,
        capacity: null,
        technology: "Hybrid Inverter",
        extractedKeywords: ["growatt", "1000w", "48v"],
        rawText: "Growatt 1000W Inverter 48V",
      })));

      const result = await extractTextFromImage(Buffer.from("raw-image"));

      expect(result).toEqual({
        text: "Growatt 1000W Inverter 48V",
        confidence: 95,
        extractedKeywords: ["growatt", "1000w", "48v"],
        brand: "Growatt",
        model: undefined,
        wattage: "1000",
        voltage: "48",
        capacity: undefined,
        technology: "Hybrid Inverter",
      });
    });

    it("returns the raw reply with zero confidence when it isn't JSON", async () => {
      createCompletion.mockResolvedValue(reply("I can't read this label."));

      await expect(extractTextFromImage(Buffer.from("raw-image"))).resolves.toEqual({
        text: "I can't read this label.",
        confidence: 0,
        extractedKeywords: [],
      });
    });
  });
});
