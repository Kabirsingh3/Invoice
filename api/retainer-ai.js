// Vercel serverless function: AI assistant for retainer agreements.
//
// Works with either AI provider — set ONE of these in Vercel → Settings →
// Environment Variables:
//   GEMINI_API_KEY     Google Gemini (has a free tier) — key from aistudio.google.com
//   ANTHROPIC_API_KEY  Anthropic Claude (pay-as-you-go) — key from console.anthropic.com
// If both are set, Gemini is used unless AI_PROVIDER=anthropic.
// The key lives ONLY here on the server and is never sent to the browser.
//
// Only signed-in admins / super admins can use it: every request carries the
// login details from the app, which are checked against Supabase first, so
// strangers can't run up your AI bill.

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
// "gemini-flash-latest" always points to Google's current Flash model.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function pickProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are missing on Vercel.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error("Supabase check failed (" + res.status + ")");
  return res.json();
}

async function isAdmin(auth) {
  if (!auth || !auth.companyId || !auth.username || !auth.password) return false;
  const cid = encodeURIComponent(auth.companyId);
  const companies = await supabaseGet(`companies?id=eq.${cid}&select=username,password`);
  const c = companies[0];
  if (c && c.username === auth.username && c.password === auth.password) return true;
  const users = await supabaseGet(
    `technicians?company_id=eq.${cid}&username=eq.${encodeURIComponent(auth.username)}&select=password,role`
  );
  const u = users[0];
  return !!(u && u.password === auth.password && (u.role === "admin" || u.role === "super_admin"));
}

function systemPrompt(company, retainer, provider) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a pricing and contracts assistant built into the quoting app of a South African electrical (and plumbing) contracting business. Today is ${today}. All amounts are in South African Rand (R).

THE BUSINESS (the "Service Provider"):
Name: ${company?.name || ""}
Address: ${company?.address || ""}
Email: ${company?.email || ""}
Phone: ${company?.phone || ""}

YOUR JOB
Help the owner work out a monthly maintenance retainer for a client and write the retainer agreement.
1. Work out the price. When information is missing, ask short, specific questions (at most 3 at a time): type of client and property, number of sites/units/blocks, distance or travel, routine maintenance visits per month, emergency call-outs included per month, response times, hours of cover, the owner's normal hourly and call-out rates, whether materials are included, contract length, and whether the business is VAT-registered.
   If the owner asks you to just work it out, use sensible assumptions for the South African market, state every assumption clearly, and show the calculation (e.g. hours x rate + travel + allowance for call-outs, then a retainer discount or margin). Round the monthly fee to a sensible figure. Show the workings in your reply.
2. Fill in the details fields whenever you know or have proposed them.
3. Write or update the agreement whenever you have enough information or the owner asks for a change. Always return the COMPLETE agreement text, not just the changed part.

AGREEMENT CONTENT
Plain, clear English. Include where relevant: parties; definitions; scope of services (what's included); exclusions; routine maintenance schedule; emergency call-outs and response times; after-hours work and rates for work outside the retainer; materials and parts (how they are charged); monthly fee, invoicing and payment terms (state whether amounts include or exclude VAT); late payment; annual price escalation; term, renewal and termination/notice; access to premises and the client's responsibilities; health and safety; certificates of compliance for electrical work where applicable; warranties on workmanship; limitation of liability; suspension for non-payment; disputes; general clauses; signatures.
Do NOT mention plumbing certificates of compliance or PIRB. Do not invent registration numbers, VAT numbers or bank details; use a blank line like "_____________" where something is unknown.
If the client may be a consumer, note in your reply (not in the agreement) that the Consumer Protection Act can affect fixed-term contracts and cancellation, and recommend the owner has the final template checked by a lawyer. Never claim the agreement is legally guaranteed.

AGREEMENT FORMAT (so the app can turn it into a PDF)
- Plain text only. No markdown bold, italics or tables.
- Section headings on their own line starting with "## " (e.g. "## 3. Scope of Services").
- Numbered clauses like "3.1 ..." on their own lines. Blank line between paragraphs.
- Do not include a title line or signature block; the app adds those.

REPLY STYLE
The owner reads this on a phone. Keep replies short and practical. Use simple lists with "-" where helpful.

CURRENT STATE OF THIS RETAINER
${JSON.stringify(
    {
      title: retainer?.title || "",
      client_name: retainer?.client_name || "",
      client_address: retainer?.client_address || "",
      client_email: retainer?.client_email || "",
      monthly_fee: retainer?.monthly_fee || 0,
      start_date: retainer?.start_date || "",
      term_months: retainer?.term_months || null
    },
    null,
    2
  )}

CURRENT AGREEMENT TEXT:
${retainer?.agreement_text ? retainer.agreement_text.slice(0, 30000) : "(none yet)"}

${
    provider === "gemini"
      ? `Always answer with a single JSON object with these keys: "reply" (string, required), "fields" (object with only the details you set or change: title, client_name, client_address, client_email, monthly_fee as a number, start_date as YYYY-MM-DD, term_months as a whole number), and "agreement_text" (the COMPLETE agreement; leave it out if the agreement doesn't change).`
      : `Always answer by calling the "respond" tool.`
  }`;
}

const RESPOND_TOOL = {
  name: "respond",
  description: "Reply to the owner and optionally update the retainer details and agreement.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Your message to the owner (questions, pricing workings, summary of changes)." },
      fields: {
        type: "object",
        description: "Only the details you want to set or change. Leave out anything unchanged.",
        properties: {
          title: { type: "string", description: "Short name, e.g. 'Monthly electrical maintenance – Sunset Complex'" },
          client_name: { type: "string" },
          client_address: { type: "string" },
          client_email: { type: "string" },
          monthly_fee: { type: "number", description: "Monthly fee in Rand as charged on the invoice" },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          term_months: { type: "integer" }
        }
      },
      agreement_text: {
        type: "string",
        description: "The COMPLETE updated agreement text. Leave out if the agreement doesn't change in this turn."
      }
    },
    required: ["reply"]
  }
};

async function callClaude(system, convo) {
  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system,
      tools: [RESPOND_TOOL],
      tool_choice: { type: "tool", name: "respond" },
      messages: convo
    })
  });
  const data = await aiRes.json();
  if (!aiRes.ok) return { error: data?.error?.message || `AI request failed (${aiRes.status})` };
  const toolBlock = (data.content || []).find((b) => b.type === "tool_use" && b.name === "respond");
  if (!toolBlock) {
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { out: { reply: text || "Sorry, I couldn't come up with a reply. Please try again." } };
  }
  return { out: toolBlock.input || {}, truncated: data.stop_reason === "max_tokens" };
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    fields: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        client_name: { type: "STRING" },
        client_address: { type: "STRING" },
        client_email: { type: "STRING" },
        monthly_fee: { type: "NUMBER" },
        start_date: { type: "STRING" },
        term_months: { type: "INTEGER" }
      }
    },
    agreement_text: { type: "STRING" }
  },
  required: ["reply"]
};

async function callGemini(system, convo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const baseBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: convo.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_SCHEMA,
      maxOutputTokens: 16384
    }
  };
  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 110000);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      if (e.name === "AbortError") return null;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  // Ask for quick (low) thinking so replies come back faster; older models
  // don't support this setting, so retry without it if Google rejects it.
  let aiRes = await post({ ...baseBody, generationConfig: { ...baseBody.generationConfig, thinkingConfig: { thinkingLevel: "low" } } });
  if (aiRes && aiRes.status === 400) {
    const errText = await aiRes.clone().text().catch(() => "");
    if (/thinking/i.test(errText)) aiRes = await post(baseBody);
  }
  if (!aiRes) {
    return { status: 504, error: "Google's AI took too long to answer. Try again, or ask for one thing at a time (e.g. just the price first)." };
  }
  const data = await aiRes.json().catch(() => ({}));
  if (!aiRes.ok) {
    if (aiRes.status === 429) {
      return {
        status: 429,
        error: "The free Google AI limit has been reached for now. Wait a minute and try again (or tomorrow if the daily limit is used up)."
      };
    }
    return { error: data?.error?.message || `AI request failed (${aiRes.status})` };
  }
  const cand = data.candidates?.[0];
  if (!cand) {
    return { error: "Google's AI didn't return an answer" + (data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : "") + ". Try rewording." };
  }
  const text = (cand.content?.parts || []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  const truncated = cand.finishReason === "MAX_TOKENS";
  let out;
  try {
    out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch (e) {
    if (truncated) return { out: { reply: "" }, truncated: true };
    return { out: { reply: text || "Sorry, I couldn't come up with a reply. Please try again." } };
  }
  return { out, truncated };
}

export default async function handler(req, res) {
  const provider = pickProvider();
  if (req.method === "GET") {
    // Health check: open /api/retainer-ai in a browser to see if the AI is set up.
    res.status(200).json({
      ok: true,
      provider: provider || "none — add GEMINI_API_KEY in Vercel and redeploy",
      model: provider === "gemini" ? GEMINI_MODEL : provider === "anthropic" ? CLAUDE_MODEL : null,
      supabase: !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
    });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!provider) {
    res.status(500).json({
      error: "The AI isn't set up yet: add GEMINI_API_KEY (free, from aistudio.google.com) in Vercel → Settings → Environment Variables, then redeploy."
    });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { auth, company, retainer, messages } = body;

    if (!(await isAdmin(auth))) {
      res.status(401).json({ error: "Only admins can use the AI assistant. Sign out and back in, then try again." });
      return;
    }

    // Keep the conversation a reasonable size, and make sure it starts with the user.
    let convo = (Array.isArray(messages) ? messages : [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    while (convo.length && convo[0].role !== "user") convo.shift();
    // Merge back-to-back messages from the same side (e.g. after a failed AI reply).
    convo = convo.reduce((acc, m) => {
      const last = acc[acc.length - 1];
      if (last && last.role === m.role) last.content += "\n\n" + m.content;
      else acc.push({ ...m });
      return acc;
    }, []);
    if (!convo.length || convo[convo.length - 1].role !== "user") {
      res.status(400).json({ error: "Type a message first." });
      return;
    }

    const system = systemPrompt(company, retainer, provider);
    const result = provider === "gemini" ? await callGemini(system, convo) : await callClaude(system, convo);
    if (result.error) {
      res.status(result.status || 502).json({ error: result.error });
      return;
    }
    const out = result.out || {};
    if (result.truncated) {
      // The agreement got cut off; don't overwrite the existing one with half a document.
      res.status(200).json({
        reply: (out.reply || "") + "\n\n(The agreement was too long to finish in one go, so I didn't change it. Ask me to update one section at a time.)",
        fields: out.fields || null
      });
      return;
    }
    res.status(200).json({ reply: out.reply || "", fields: out.fields || null, agreement_text: out.agreement_text || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong: " + (err?.message || String(err)) });
  }
      }
