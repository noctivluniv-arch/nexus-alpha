import { GoogleGenAI } from "@google/genai";

function createAiClient(): GoogleGenAI {
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
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
