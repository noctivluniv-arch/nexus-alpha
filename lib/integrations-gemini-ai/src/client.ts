import { GoogleGenAI } from "@google/genai";

function createAiClient(): GoogleGenAI {
  if (process.env.GEMINI_API_KEY) {
    return new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    throw new Error(
      "GEMINI_API_KEY or AI_INTEGRATIONS_GEMINI_BASE_URL must be set.",
    );
  }

  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set when using Replit AI proxy.",
    );
  }

  return new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
}

let _ai: GoogleGenAI | undefined;

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    if (!_ai) {
      _ai = createAiClient();
    }
    return (_ai as unknown as Record<string | symbol, unknown>)[prop];
  },
});
