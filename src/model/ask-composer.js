// The Ask AI composer's pure parts, in the shape of Live AI Assistant's own chat composer: / commands, [[page]], #tag
// and ((block)) mentions, styles, the tools and agents that only run in Live AI's chat, thinking effort, and the
// roamContext a question sends. No DOM, no Roam: the view and host pass the data in.
//
// Command and style prompts are ported from Live AI Assistant by Fabrice Gallet (MIT),
// https://github.com/fbgallet/roam-extension-live-ai-assistant — src/ai/prebuildCommands.js (BUILTIN_COMMANDS),
// src/ai/prompts.js (completionCommands, stylePrompts, introduceStylePrompt) and
// src/ai/agents/chat-agent/tools/chatToolsRegistry.ts (CHAT_TOOLS). Live AI's Roam-output rules are left out:
// answers here land in a chat bubble, not in blocks.

export const COMMAND_CATEGORIES = Object.freeze(["CONTENT ANALYSIS", "CRITICAL REASONING TOOLKIT", "REPHRASING", "TRANSLATION", "ACTION", "CUSTOM PROMPTS", "STYLES"]);

const SAME_LANGUAGE = "\nAnswer in the language of the content unless I ask otherwise.";

export const COMMANDS = Object.freeze([
  {
    id: "summarize", name: "Summarize", category: "CONTENT ANALYSIS", keywords: "summary resume abstract",
    prompt: `Please provide a concise, cohesive summary of the following content, focusing on:
- Essential main ideas and key arguments
- Critical supporting evidence and examples
- Major conclusions or recommendations
- Underlying themes or patterns
Keep the summary significantly shorter than the original while preserving core meaning and context. Present it in well-structured paragraph(s) that flow naturally, avoiding fragmented bullet points. If the content has a clear chronological or logical progression, maintain this structure in your summary.${SAME_LANGUAGE}`,
  },
  {
    id: "keyInsights", name: "Extract key insights", category: "CONTENT ANALYSIS", keywords: "key points takeaways",
    prompt: `Analyze the provided content and identify the most significant, novel, or actionable insights. For each insight:
  1. State the core idea clearly and concisely
  2. Explain why it's particularly noteworthy or valuable
  3. Highlight its potential applications or implications
  4. If relevant, note how it challenges conventional thinking or offers unique perspectives
Please organize these insights by their potential impact rather than their order of appearance in the original content.${SAME_LANGUAGE}`,
  },
  {
    id: "extractActionable", name: "Extract actionable items", category: "CONTENT ANALYSIS", keywords: "tasks todo actions",
    prompt: `Please analyze the following content and extract all actionable items. Present them as a prioritized task list that:
  1. Identifies only concrete, specific actions (not vague goals)
  2. Orders tasks by both urgency and logical sequence (dependencies)
  3. Uses clear, action-oriented language starting with verbs
  4. Groups related tasks together when appropriate
  5. Indicates any dependencies between tasks
  6. Specifies if any tasks can be done in parallel
Please ensure each action item is specific enough to be executed without needing additional clarification.${SAME_LANGUAGE}`,
  },
  {
    id: "quiz", name: "Quiz on provided content", category: "CONTENT ANALYSIS", keywords: "test questions learn",
    prompt: `You are a quiz creator. Based on the content provided, create an engaging quiz:
1. Identify 1-3 key points worth testing: core concepts and definitions, strong arguments, commonly misunderstood elements, critical insights.
2. Number each question (1., 2., …) and give 3-4 plausible multiple-choice options (a), b), c)…). Allow single or multiple correct answers when appropriate.
3. I will answer like 1a, 2b. Then give detailed feedback for each answer, explain why the right answers are right and the wrong ones wrong, and ask if I want more questions on the same content.${SAME_LANGUAGE}`,
  },
  {
    id: "explanation", name: "Explanation", category: "CRITICAL REASONING TOOLKIT", keywords: "explain meaning understand",
    prompt: `Provide a clear and precise explanation of the element provided. Answer the question: 'What exactly does this mean and how should it be understood?'
1. Adapt the explanation to the element's type: terms (semantic fields and usage), concepts (theoretical framework and scope), statements (logical structure and implications), reasoning (premises and inferential patterns).
2. Break down the internal components and their relationships, then place the element in its broader context.
3. Focus on meaning and understanding, avoid justification or mere examples. Use clear, straightforward language and stay concise: avoid multiplying bullet points and focus on the key points.${SAME_LANGUAGE}`,
  },
  {
    id: "meaning", name: "Definition, meaning", category: "CRITICAL REASONING TOOLKIT", keywords: "define definition term",
    prompt: `Provide a clear and precise semantic explanation of the term, concept or statement provided. Be concise and direct, unambiguous (no circular definitions or vague terms), self-contained, rigorous yet accessible, and explain the meaning specifically within the provided context. Format your response as a straightforward definition focused solely on meaning.${SAME_LANGUAGE}`,
  },
  {
    id: "example", name: "Example", category: "CRITICAL REASONING TOOLKIT", keywords: "illustrate instance",
    prompt: `Provide a paradigmatic example that illustrates the idea or statement provided. Make it concrete, vivid, and thought-provoking while capturing the essence of what it exemplifies. Express it in clear, straightforward language without any introductory phrases or commentary.${SAME_LANGUAGE}`,
  },
  {
    id: "causalExplanation", name: "Causal explanation", category: "CRITICAL REASONING TOOLKIT", keywords: "why cause mechanism",
    prompt: `Provide a causal explanation of the element provided. Focus strictly on what produces, generates, or brings about it: identify the mechanisms, forces, or principles at work and the most relevant type of causation. Avoid mere semantic explanation or justification. Stay concise, structure the response from fundamental to derivative causes, and if the input is not suitable for causal explanation, say so and explain why.${SAME_LANGUAGE}`,
  },
  {
    id: "analogicalExplanation", name: "Explanation by analogy", category: "CRITICAL REASONING TOOLKIT", keywords: "analogy compare",
    prompt: `Provide a clear and illuminating analogical explanation of the element provided. Compare its structure and relationships to those found in a different, more familiar domain, point out the key structural correspondences, and use imagery that is immediately graspable yet thought-provoking. Be concise and elegant, without unnecessary technical language.${SAME_LANGUAGE}`,
  },
  {
    id: "argument", name: "Argument", category: "CRITICAL REASONING TOOLKIT", keywords: "support justify reason",
    prompt: `Provide a strong, well-structured argument supporting the statement or idea provided. Make the premises explicit, rely on evidence or sound reasoning, and keep it concise and clear.${SAME_LANGUAGE}`,
  },
  {
    id: "objection", name: "Objection, counterargument", category: "CRITICAL REASONING TOOLKIT", keywords: "critique criticism counter",
    prompt: `Generate one significant potential objection challenging the provided statement, idea or reasoning. Make its premises explicit, base it on evidence or sound reasoning, and keep it concise and clear.${SAME_LANGUAGE}`,
  },
  {
    id: "counterExample", name: "Counterexample", category: "CRITICAL REASONING TOOLKIT", keywords: "refute exception",
    prompt: `Provide a relevant counterexample to the idea or statement provided, significant enough to deeply challenge its truth. Make it concrete, vivid, and thought-provoking. Express it in clear, straightforward language.${SAME_LANGUAGE}`,
  },
  {
    id: "challengeMyIdeas", name: "Challenge my ideas!", category: "CRITICAL REASONING TOOLKIT", keywords: "critique assumptions flaws",
    prompt: `Act as a rigorous critical thinker and challenge the ideas presented by:
- Identifying key hidden assumptions and questioning their validity
- Pointing out potential logical flaws or inconsistencies
- Highlighting practical implementation challenges
- Raising specific counterexamples that test the robustness of the reasoning
- Suggesting alternative perspectives that could lead to different conclusions
Keep your response focused on only 2-3 most significant challenges. Be direct and specific. Aim to deepen the analysis rather than dismiss the ideas.${SAME_LANGUAGE}`,
  },
  {
    id: "raiseQuestions", name: "Raise questions", category: "CRITICAL REASONING TOOLKIT", keywords: "questions inquiry",
    prompt: `Analyze the content carefully and generate thought-provoking questions about it. Your questions should challenge underlying assumptions, question what seems taken for granted, propose alternative perspectives, explore implications that are not immediately obvious, and include both naive and sophisticated questions. Format your response as a numbered list of clear, direct questions, from fundamental to more subtle. Avoid any redundancy and do not suggest more than 7 questions.${SAME_LANGUAGE}`,
  },
  {
    id: "perspectiveShift", name: "Perspective shift", category: "CRITICAL REASONING TOOLKIT", keywords: "reframe angle",
    prompt: `Help me see the content provided in a radically different light. Choose the single most relevant strategy: three unconventional angles I haven't considered; thought-provoking 'what if' questions that flip my assumptions; how three very different people would interpret it; or hidden opportunities in what looks like a limitation. Be bold and creative while staying logically coherent, and end with a key question that makes me reconsider my perspective.${SAME_LANGUAGE}`,
  },
  {
    id: "rephrase", name: "Rephrase", category: "REPHRASING", keywords: "paraphrase reword",
    prompt: `Please rephrase the following text, keeping exactly the same meaning and information, but using different words and structures. Use natural, straightforward language without jargon or flowery vocabulary. Maintain the original tone and level of formality.${SAME_LANGUAGE}`,
  },
  {
    id: "shorten", name: "Shorter", category: "REPHRASING", keywords: "concise shorten",
    prompt: `Please rephrase the following text to be more concise while closely preserving its original style, tone, and intent. Keep the same key phrases where possible, only removing redundancies and shortening overly complex sentences. Maintain the same level of formality and all core ideas.${SAME_LANGUAGE}`,
  },
  {
    id: "accessible", name: "Simpler, more accessible", category: "REPHRASING", keywords: "simple plain easy",
    prompt: `Rephrase the following text using simpler, more accessible language while keeping all the information. Avoid complex sentences and technical terms. The result should be easily understood by a general audience.${SAME_LANGUAGE}`,
  },
  {
    id: "clearer", name: "Clearer and more explicit", category: "REPHRASING", keywords: "clarify clear",
    prompt: `Please rephrase the following text: keep its core meaning and the author's voice, break complex or lengthy sentences into clearer ones, make vague or implicit statements explicit, replace jargon with clearer alternatives, and eliminate redundant or empty phrases.${SAME_LANGUAGE}`,
  },
  {
    id: "outline", name: "Paragraph to Outline", category: "REPHRASING", keywords: "structure bullets hierarchy",
    prompt: `Convert the following text into a hierarchically structured outline that reflects its logical organization. Keep the original wording, use indentation to show hierarchical relationships, keep all content but reorganize it to show relative importance and connections, and begin each bullet with "-". Do not paraphrase or modify the original text.`,
  },
  {
    id: "actionPlan", name: "Action plan for a project", category: "ACTION", keywords: "plan steps project",
    prompt: `Based on the content provided, propose a concrete action plan: the goal, the main steps in logical order, the key actions for each step, likely obstacles and how to handle them, and how to know each step is done. Keep it practical and concise.${SAME_LANGUAGE}`,
  },
  {
    id: "howTo", name: "How to... (active learning)", category: "ACTION", keywords: "learn guide steps",
    prompt: `Explain how to do what the content describes, as an active learning guide: the prerequisites, the steps in order with the reasoning behind each, the common mistakes to avoid, and a small exercise I can do to check I understood.${SAME_LANGUAGE}`,
  },
]);

export const LANGUAGES = Object.freeze(["English", "French", "Spanish", "German", "Italian", "Portuguese", "Russian", "Ukrainian", "Chinese", "Japanese", "Korean", "Arabic"]);

const translatePrompt = (language) => `YOUR JOB: Translate the content provided into clear and correct ${language} (without verbosity or overly formal expressions), taking care to adapt idiomatic expressions rather than providing a too-literal translation. The content provided can be a sentence, a whole text or a simple word. Don't insert any line breaks if the provided statement doesn't have line breaks itself.`;

export const TRANSLATIONS = Object.freeze(LANGUAGES.map((language, i) => ({
  id: `translate:${language}`, name: `Translate to ${language}`, category: "TRANSLATION", keywords: `translate translation ${language}`,
  prompt: translatePrompt(language),
})));

// Live AI's introduction to a style prompt, then its built-in styles (Normal = no style).
export const STYLE_INTRO = "All your responses will follow the following style format constraints and instructions. Any other provided instructions are of course also to apply, unless they are contrary to these ones:\n\n";
export const BUILTIN_STYLES = Object.freeze([
  { id: "Concise", name: "Concise", prompt: "The response must be concise and quickly get to the point. The user expects an immediately understandable and actionable answer to their request, which does not require a long reading and interpretation. Avoid all unnecessary elaborations, embellishments, examples or digressions." },
  { id: "Conversational", name: "Conversational", prompt: "Respond as if you are having a lively and oral conversation with the human user. The tone should be that of a friendly, spoken conversation. Your responses should be brief (unless asked to elaborate) and end with a question or an invitation to continue the conversation." },
  { id: "No bullet points", name: "No bullet points", prompt: "Never break down your response into multiple bullet points, but always write complete sentences. If your response consists of several points, they should either be brief and logically articulated in a paragraph, or developed in separate paragraphs." },
  { id: "Socratic", name: "Socratic", prompt: "Your response should be formulated in the style of Socrates, as he appears in Plato's dialogues. Instead of directly answering requests and presenting supposedly established knowledge, address the user with questions that lead them to examine their own beliefs and reasoning. Address only one point per response, or even just one step of reasoning at a time, seeking the user's agreement before moving on." },
]);

// Live AI's chat tools (CHAT_TOOLS). They only run inside Live AI's own chat, so picking one hands the conversation over.
export const TOOL_CATEGORIES = Object.freeze({ context: "Context", edit: "Edit the graph", skills: "Skills", interaction: "Interaction" });
export const LIVE_TOOLS = Object.freeze([
  { id: "add_to_context", name: "Add to context", category: "context", description: "Add Roam content (pages, blocks, linked references, sidebar, daily notes) to the chat context." },
  { id: "ask_your_graph", name: "Ask Your Graph", category: "context", description: "Natural-language queries over the graph to find matching pages or blocks." },
  { id: "vector_search", name: "Vector search", category: "context", description: "Semantic search over the indexed graph and uploaded files (needs Live AI's vector store)." },
  { id: "select_results_by_criteria", name: "Select results", category: "context", description: "Check or filter context results by date, content pattern or meaning." },
  { id: "color_highlighter", name: "Color highlighter", category: "context", description: "Extract passages by highlight colour, or apply colours (Color Highlighter extension)." },
  { id: "get_help", name: "Live AI help", category: "context", description: "Fetch Live AI's own documentation." },
  { id: "create_block", name: "Create blocks", category: "edit", description: "Write blocks into Roam." },
  { id: "create_page", name: "Create a page", category: "edit", description: "Create a Roam page from Markdown." },
  { id: "update_block", name: "Update blocks", category: "edit", description: "Edit, move, open or collapse blocks." },
  { id: "delete_block", name: "Delete blocks", category: "edit", description: "Delete blocks and their children." },
  { id: "run_smartblock", name: "Run a SmartBlock", category: "edit", description: "Trigger a SmartBlocks workflow." },
  { id: "live_ai_skills", name: "Skills", category: "skills", description: "Use skills stored in Roam with #liveai/skill." },
  { id: "ask_user_choice", name: "Ask me to choose", category: "interaction", description: "Inline choice forms: quizzes, polls, decisions." },
  { id: "random_pick", name: "Random pick", category: "interaction", description: "Pick items at random from a list." },
]);

// Context sources besides the PDF part, in Live AI's roamContext terms.
export const CONTEXT_SOURCES = Object.freeze([
  { key: "part", label: "This PDF part" },
  { key: "page", label: "Current page" },
  { key: "linkedRefs", label: "Linked references" },
  { key: "sidebar", label: "Sidebar" },
  { key: "logPages", label: "Daily notes" },
]);
export const DEFAULT_LOG_DAYS = 7;
export const MAX_SUGGESTIONS = 20;

// ------------------------------------------------------------------ triggers

// What the text before the caret is asking for: a / command (the composer starts with "/"), a [[page]], a #tag, a
// ((block)) or an @ part. Returns { kind: "command" | "page" | "tag" | "block" | "at", query, start } or null; start is the trigger's index.
export function triggerAt(text, caret) {
  const src = String(text ?? "");
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, src.length)) : src.length;
  const before = src.slice(0, at);
  const cmd = /^\/([^\n/]{0,60})$/.exec(before);
  if (cmd) return { kind: "command", query: cmd[1], start: 0 };
  const open = (o, c) => {
    const i = before.lastIndexOf(o);
    if (i < 0) return null;
    const q = before.slice(i + 2);
    if (q.includes(c) || q.includes("\n") || q.length > 80) return null;
    return { i, q };
  };
  const page = open("[[", "]]");
  const blk = open("((", "))");
  if (page && (!blk || page.i > blk.i)) return { kind: "page", query: page.q, start: page.i };
  if (blk) return { kind: "block", query: blk.q, start: blk.i };
  const tag = /(^|[\s(])#([^\s#[\]()]{0,60})$/.exec(before);
  if (tag) return { kind: "tag", query: tag[2], start: before.length - tag[2].length - 1 };
  const mention = /(^|[\s(])@([^\s@]{0,40}(?: \d{1,3})?)$/.exec(before);
  if (mention) return { kind: "at", query: mention[2], start: before.length - mention[2].length - 1 };
  return null;
}

// The text with the trigger replaced by the chosen mention; a "]]" or "))" right after the caret (auto-closed) goes too.
export function applyMention(text, trigger, caret, insert) {
  const src = String(text ?? "");
  const at = Number.isInteger(caret) ? caret : src.length;
  let end = at;
  const close = trigger.kind === "block" ? "))" : trigger.kind === "page" ? "]]" : "";
  if (close && src.slice(end, end + 2) === close) end += 2;
  const head = src.slice(0, trigger.start);
  let tail = src.slice(end);
  const ins = String(insert);
  if (tail && !/^\s/.test(tail)) tail = ` ${tail}`;
  const next = `${head}${ins}${tail || " "}`;
  return { text: next, caret: head.length + ins.length + 1 };
}

export const pageMention = (title) => `[[${title}]]`;
export const blockMention = (uid) => `((${uid}))`;

// ------------------------------------------------------------------ ranking

const lower = (s) => String(s ?? "").toLowerCase();
// Subsequence score: smaller is better; null when the letters are not all there in order.
function fuzzy(hay, needle) {
  let pos = -1;
  let gaps = 0;
  for (const ch of needle) {
    const next = hay.indexOf(ch, pos + 1);
    if (next < 0) return null;
    if (pos >= 0) gaps += next - pos - 1;
    pos = next;
  }
  return gaps;
}

// Page titles for a query: exact, prefix, word start, substring, then fuzzy; shorter first within a class.
// `index` may be a prepared index (prepareTitles) or a plain array of titles.
export function prepareTitles(titles) {
  const list = [];
  for (const t of titles || []) if (typeof t === "string" && t && !t.startsWith("roam/")) list.push({ t, l: t.toLowerCase() });
  return list;
}
export function rankTitles(index, query, limit = MAX_SUGGESTIONS) {
  const list = Array.isArray(index) && typeof index[0] === "string" ? prepareTitles(index) : index || [];
  const q = lower(query).trim();
  if (!q) return list.slice().sort((a, b) => a.t.length - b.t.length).slice(0, limit).map((x) => x.t);
  const scored = [];
  for (const x of list) {
    let cls;
    let extra = 0;
    if (x.l === q) cls = 0;
    else if (x.l.startsWith(q)) cls = 1;
    else {
      const i = x.l.indexOf(q);
      if (i > 0) cls = /[\s/([{\-_.:]/.test(x.l[i - 1]) ? 2 : 3;
      else {
        const g = q.length > 1 ? fuzzy(x.l, q) : null;
        if (g == null || g > 24) continue;
        cls = 4;
        extra = g;
      }
    }
    scored.push([cls, extra, x.t.length, x.t]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : 1));
  return scored.slice(0, limit).map((s) => s[3]);
}

// Menu items whose name or keywords match every word of the query; prefix matches first.
export function filterCommands(items, query, limit = 60) {
  const words = lower(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return (items || []).slice(0, limit);
  const hits = [];
  for (const it of items || []) {
    const name = lower(it.name);
    const hay = `${name} ${lower(it.keywords)} ${lower(it.category)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    hits.push([name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2, it]);
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, limit).map((h) => h[1]);
}

// ------------------------------------------------------------------ mentions and roamContext

// [[Title]], #[[Title]], #Tag and ((uid)) in a question, in order, without repeats.
export function parseMentions(text) {
  const src = String(text ?? "");
  const pages = [];
  const blocks = [];
  const re = /#?\[\[([^[\]\n]+)\]\]|(?:^|(?<=[\s(]))#([^\s#[\]()]+)|\(\(([\w-]{9})\)\)/g;
  let m;
  while ((m = re.exec(src))) {
    const title = (m[1] ?? m[2] ?? "").trim();
    if (title) { if (!pages.includes(title)) pages.push(title); continue; }
    if (m[3] && !blocks.includes(m[3])) blocks.push(m[3]);
  }
  return { pages, blocks };
}

// The roamContext for Live AI's generate(): mentioned pages and blocks plus the toggled sources. null when there is
// nothing to send. `currentTitle` is the page open in Roam's main view: Live AI only fills it in itself when no page is
// named, so it goes into the arguments whenever the arguments are not empty.
export function buildRoamContext({ pages = [], blocks = [], sources = {}, logDays = DEFAULT_LOG_DAYS, currentTitle = "" } = {}) {
  const rc = {};
  const pageArgs = [...new Set(pages.filter(Boolean))];
  if (sources.page && currentTitle && !pageArgs.includes(currentTitle)) pageArgs.unshift(currentTitle);
  if (pageArgs.length) { rc.page = true; rc.pageArgument = pageArgs; } else if (sources.page) rc.page = true;
  if (sources.linkedRefs) {
    rc.linkedRefs = true;
    if (currentTitle) rc.linkedRefsArgument = [currentTitle];
  }
  if (blocks.length) { rc.block = true; rc.blockArgument = [...new Set(blocks.filter(Boolean))]; }
  if (sources.sidebar) rc.sidebar = true;
  if (sources.logPages) {
    rc.logPages = true;
    const n = Math.round(Number(logDays));
    rc.logPagesArgument = Number.isFinite(n) && n > 0 ? Math.min(n, 365) : DEFAULT_LOG_DAYS;
  }
  return Object.keys(rc).length ? rc : null;
}

// The PDF part's context in the first user message, for when roamContext takes generate()'s context slot.
export const PART_HEADER = "Context from the PDF (cite pages as [p. N]):";
export function withPartContext(messages, context) {
  const list = (messages || []).map((m) => ({ ...m }));
  const ctx = String(context ?? "").trim();
  if (!ctx) return list;
  const first = list.findIndex((m) => m.role === "user");
  const head = `${PART_HEADER}\n\n${ctx}`;
  if (first < 0) return [{ role: "user", content: head }, ...list];
  list[first] = { ...list[first], content: `${head}\n\n---\n\n${list[first].content}` };
  return list;
}

// ------------------------------------------------------------------ custom prompts and styles

// Rows: [{ uid, string, children: [{ string, children }] }] for blocks tagged #liveai/prompt or #liveai/style.
// The name is the block text without the tag (first six words, four for styles, as Live AI shows them); the prompt is
// the children as an indented list, or the block text when it has none.
const TAG_RE = (tag) => new RegExp(`#\\[\\[${tag.replace("/", "\\/")}\\]\\]|#${tag.replace("/", "\\/")}\\b|\\[\\[${tag.replace("/", "\\/")}\\]\\]`, "gi");
export function flattenChildren(children, depth = 0) {
  const out = [];
  for (const c of children || []) {
    const s = String(c?.string ?? "").trim();
    if (s) out.push(`${"  ".repeat(depth)}- ${s}`);
    if (c?.children?.length) out.push(flattenChildren(c.children, depth + 1));
  }
  return out.filter(Boolean).join("\n");
}
export function customItems(rows, tag) {
  const isStyle = /style/.test(tag);
  const out = [];
  for (const r of rows || []) {
    if (!r?.uid) continue;
    const bare = String(r.string ?? "").replace(TAG_RE(tag), "").replace(/\s+/g, " ").trim();
    const name = bare.split(" ").slice(0, isStyle ? 4 : 6).join(" ") || (isStyle ? "Style" : "Prompt");
    const kids = flattenChildren(r.children);
    out.push({ id: `${isStyle ? "style" : "prompt"}:${r.uid}`, uid: r.uid, name, prompt: kids || bare, category: isStyle ? "STYLES" : "CUSTOM PROMPTS", custom: true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", ignorePunctuation: true }));
}

// The system prompt with a style appended the way Live AI introduces one.
export function withStyle(systemPrompt, style) {
  const s = String(style?.prompt ?? "").trim();
  if (!s) return String(systemPrompt ?? "");
  const base = String(systemPrompt ?? "").trim();
  return `${base ? `${base}\n\n` : ""}${STYLE_INTRO}${s}`;
}

// ------------------------------------------------------------------ thinking effort

// The effort levels a model offers (Live AI's listModels() thinkingEfforts); [] for models that do not think.
export function effortsFor(model) {
  const list = Array.isArray(model?.thinkingEfforts) ? model.thinkingEfforts.filter((e) => typeof e === "string" && e) : [];
  if (list.length) return list;
  return model?.thinking ? ["low", "medium", "high"] : [];
}
// generate() options for an effort choice: "" = the model's default (nothing sent), "off" = thinking off.
export function effortOptions(choice, model) {
  if (!choice) return {};
  const levels = effortsFor(model);
  if (!levels.length) return {};
  if (choice === "off") return { thinking: false };
  return levels.includes(choice) ? { thinking: true, effort: choice } : {};
}
