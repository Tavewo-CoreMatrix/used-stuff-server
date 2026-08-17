import OpenAI from "openai";
import { env } from "../config/env.js";

export interface VerificationResult {
  text: string;
  confidence: number;
  extractedKeywords: string[];
  brand?: string;
  model?: string;
  wattage?: string;
  voltage?: string;
  capacity?: string;
  technology?: string;
}

const openai = new OpenAI({ apiKey: env.openaiApiKey });

const SYSTEM_PROMPT = `You are a solar equipment spec extractor. The user will send you a photo of a solar panel, battery, or inverter label/nameplate.

Extract the following fields and return ONLY valid JSON with no markdown or extra text:
{
  "brand": "manufacturer name or null",
  "model": "model number or null",
  "wattage": "e.g. 450 (number only, no unit) or null",
  "voltage": "e.g. 48 (number only, no unit) or null",
  "capacity": "e.g. 100 (Ah, number only) or null",
  "technology": "e.g. Monocrystalline, LiFePO4, Hybrid Inverter, etc. or null",
  "extractedKeywords": ["list", "of", "notable", "specs"],
  "rawText": "verbatim text you can read from the image"
}

If a field is not visible or cannot be determined, use null. Do not guess.`;

export const extractTextFromImage = async (imageBuffer: Buffer): Promise<VerificationResult> => {
  const base64 = imageBuffer.toString("base64");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } },
          { type: "text", text: "Extract the specs from this label." },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Model returned something unparseable — surface what we got as plain text
    return {
      text: raw,
      confidence: 0,
      extractedKeywords: [],
    };
  }

  return {
    text: parsed.rawText ?? "",
    confidence: 95,
    extractedKeywords: Array.isArray(parsed.extractedKeywords) ? parsed.extractedKeywords : [],
    brand: parsed.brand ?? undefined,
    model: parsed.model ?? undefined,
    wattage: parsed.wattage != null ? String(parsed.wattage) : undefined,
    voltage: parsed.voltage != null ? String(parsed.voltage) : undefined,
    capacity: parsed.capacity != null ? String(parsed.capacity) : undefined,
    technology: parsed.technology ?? undefined,
  };
};
