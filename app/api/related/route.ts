import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

export async function POST(req: Request) {
  const { query, answer } = await req.json();
  try {
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: `Question: ${query}\nAnswer: ${String(answer).slice(0, 1500)}`,
      config: {
        systemInstruction:
          "Suggest 3 short follow-up questions. Reply with only a JSON array of strings.",
        responseMimeType: "application/json",
        maxOutputTokens: 200,
      },
    });
    return Response.json(JSON.parse(r.text ?? "[]"));
  } catch {
    return Response.json([]);
  }
}