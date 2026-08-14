import type { HookEvent } from "./bash-syntax.js";

export interface ClaudeNativeQuestionAnswer {
  question: string;
  answer: string;
}

function questionsFrom(event: HookEvent): string[] {
  const questions = event.tool_input?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const question = (item as Record<string, unknown>).question;
    return typeof question === "string" && question.trim() ? [question] : [];
  });
}

/** Hosts may serialize tool output as a JSON string; unwrap it without changing other strings. */
function parseResponse(response: unknown): unknown {
  if (typeof response !== "string") return response;
  const trimmed = response.trim();
  if (!trimmed.startsWith("{")) return response;
  try { return JSON.parse(trimmed) as unknown; } catch { return response; }
}

function textResponse(response: unknown): string | undefined {
  const parsed = parseResponse(response);
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const content = (parsed as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const text = (item as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
    return texts.length ? texts.join("\n") : undefined;
  }
  return undefined;
}

function structuredAnswers(response: unknown, questions: string[]): ClaudeNativeQuestionAnswer[] {
  const parsed = parseResponse(response);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  let root = parsed as Record<string, unknown>;
  // Some host versions wrap the handler result under a `data` key.
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    root = root.data as Record<string, unknown>;
  }
  const answers = root.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return questions.flatMap((question) => {
    const answer = (answers as Record<string, unknown>)[question];
    if (typeof answer === "string" && answer.trim()) return [{ question, answer }];
    if (Array.isArray(answer) && answer.every((item) => typeof item === "string")) {
      const text = answer.join(", ").trim();
      return text ? [{ question, answer: text }] : [];
    }
    return [];
  });
}

function parseQuotedPairs(response: string): ClaudeNativeQuestionAnswer[] {
  const pairs: ClaudeNativeQuestionAnswer[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"="((?:\\.|[^"\\])*)"/g;
  for (const match of response.matchAll(pattern)) {
    try {
      const decode = (value: string): string => JSON.parse(`"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`) as string;
      const question = decode(match[1]);
      const answer = decode(match[2]);
      if (question.trim() && answer.trim()) pairs.push({ question, answer });
    } catch {
      // Ignore malformed host output instead of manufacturing user evidence.
    }
  }
  return pairs;
}

/** Extract only answers that Claude's native question UI attributes to questions it displayed. */
export function claudeNativeQuestionAnswers(event: HookEvent): ClaudeNativeQuestionAnswer[] {
  if (event.hook_event_name !== "PostToolUse" || event.tool_name !== "AskUserQuestion") return [];
  const questions = questionsFrom(event);
  if (!questions.length) return [];
  for (const response of [event.tool_response, event.tool_result]) {
    const structured = structuredAnswers(response, questions);
    if (structured.length) return structured;
    const text = textResponse(response);
    if (!text) continue;
    const allowed = new Set(questions);
    const parsed = parseQuotedPairs(text).filter((item) => allowed.has(item.question));
    if (parsed.length) return parsed;
  }
  return [];
}
