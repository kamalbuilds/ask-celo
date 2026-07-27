const ENDPOINT = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";

/**
 * The thing being sold. Kept deliberately small: the product is the payment
 * rail, and an answer is just the first thing worth paying a cent for.
 */
export async function answer(q: string): Promise<string> {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("LLM_API_KEY not set — refusing to serve a paid call with a stub");

  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "Answer in at most three sentences. Plain language, no preamble. " +
            "If you do not know, say so instead of guessing.",
        },
        { role: "user", content: q },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) throw new Error(`inference upstream ${res.status}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("inference returned no content");
  return text;
}
