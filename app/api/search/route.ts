import { GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import { allowed } from "@/lib/ratelimit";
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const tv = tavily({ apiKey: process.env.TAVILY_API_KEY! });
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

type Turn = { query: string; answer: string };

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
 if (!(await allowed(ip))) {
   return new Response(
    "Jonathan has hit its free limit for now. Please try again a little later.",
    { status: 429 }
   );
  }

try {
  const { query, history = [] } = (await req.json()) as {
    query: string;
    history?: Turn[];
  };

  // Turn follow-ups into a standalone search query
  let searchQuery = query;
  if (history.length) {
    const ctx = history
      .slice(-4)
      .map((h) => `Q: ${h.query}\nA: ${h.answer.slice(0, 500)}`)
      .join("\n");
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: `${ctx}\n\nLast question: ${query}`,
      config: {
        systemInstruction:
          "Rewrite the last question as a standalone web search query using the chat context. Reply with only the query.",
        maxOutputTokens: 150,
      },
    });
    searchQuery = r.text?.trim() || query;
  }

  // Search + full page text
  const search = await tv.search(searchQuery, {
    maxResults: 6,
    includeRawContent: "markdown",
  });

  const sources = search.results.map((r, i) => ({
    id: i + 1,
    title: r.title,
    url: r.url,
    text: (r.rawContent ?? r.content).slice(0, 3000),
  }));

  const context = sources.map((s) => `[${s.id}] ${s.title}\n${s.text}`).join("\n\n");

  const contents = [
    ...history.slice(-4).flatMap((h) => [
      { role: "user", parts: [{ text: h.query }] },
      { role: "model", parts: [{ text: h.answer }] },
    ]),
    {
      role: "user",
      parts: [{ text: `Sources:\n${context}\n\nQuestion: ${query}` }],
    },
  ];

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        // First line = sources as JSON, then the answer streams after it
        const light = sources.map(({ id, title, url }) => ({ id, title, url }));
        controller.enqueue(encoder.encode(JSON.stringify(light) + "\n"));

        const stream = await ai.models.generateContentStream({
          model: MODEL,
          contents,
          config: {
            systemInstruction:
              "Answer using ONLY the numbered sources. Cite claims like [1], [2]. If the sources don't cover it, say so. Be concise.",
          },
        });

        for await (const chunk of stream) {
          if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
        }
      } catch (e) {
        console.error("Gemini error:", e);
        controller.enqueue(
          encoder.encode("\n\nJonathan couldn't write an answer right now. The free AI limit may be used up, so please try again in a minute.")
        );
      }
      controller.close();
    },
  });

  return new Response(body, { headers: { "Content-Type": "text/plain" } });

  } catch (e) {
    console.error("Search error:", e);
    return new Response(
      "Search isn't available right now. The free limit may be used up, so please try again later.",
      { status: 503 }
    );
  }
}