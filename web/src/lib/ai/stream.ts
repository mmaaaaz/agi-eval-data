/**
 * Minimal BYOK streaming chat client — OpenAI-compatible + Anthropic SSE.
 * Keys are passed per-call and never persisted here.
 */

export type Protocol = "openai" | "anthropic";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** assistant → tool calls it emitted (openai shape, provider-neutral) */
  toolCalls?: { id: string; name: string; args: string }[];
  /** tool → result payload for the preceding tool_call */
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamArgs {
  protocol: Protocol;
  base: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  system?: string;
  tools?: ToolSpec[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

export interface StreamResult {
  text: string;
  toolCalls: { id: string; name: string; args: string }[];
  stopReason: "endturn" | "tool_use" | "aborted" | "error";
}

const trimBase = (b: string) => b.replace(/\/+$/, "");

/* ---------------- OpenAI-compatible ---------------- */

async function streamOpenAI(a: StreamArgs): Promise<StreamResult> {
  const messages: Record<string, unknown>[] = [];
  if (a.system) messages.push({ role: "system", content: a.system });
  for (const m of a.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant" && m.toolCalls?.length)
      messages.push({ role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } })) });
    else if (m.role === "assistant") messages.push({ role: "assistant", content: m.content });
    else if (m.role === "tool") messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }

  const body: Record<string, unknown> = { model: a.model, messages, stream: true };
  if (a.tools?.length)
    body.tools = a.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

  let res = await fetch(`${trimBase(a.base)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.key}` },
    body: JSON.stringify(body),
    signal: a.signal,
  });

  // some gateways/reasoning-models reject tools unless reasoning_effort is "none"
  if (!res.ok && body.tools) {
    const detail = await res.text().catch(() => "");
    if (/reasoning_effort/i.test(detail)) {
      body.reasoning_effort = "none";
      res = await fetch(`${trimBase(a.base)}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.key}` },
        body: JSON.stringify(body),
        signal: a.signal,
      });
    } else {
      throw new Error(`provider HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`provider HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  let text = "";
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let stop: StreamResult["stopReason"] = "endturn";

  await readSse(res, (data) => {
    if (data === "[DONE]") return;
    let j: { choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    const choice = j.choices?.[0];
    if (!choice) return;
    if (choice.delta?.content) {
      text += choice.delta.content;
      a.onDelta(choice.delta.content);
    }
    for (const tc of choice.delta?.tool_calls ?? []) {
      const acc = toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name += tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      toolAcc.set(tc.index, acc);
    }
    if (choice.finish_reason === "tool_calls") stop = "tool_use";
  });

  return {
    text,
    toolCalls: [...toolAcc.values()].filter((t) => t.name),
    stopReason: stop,
  };
}

/* ---------------- Anthropic ---------------- */

async function streamAnthropic(a: StreamArgs): Promise<StreamResult> {
  // Anthropic requires strict user/assistant alternation; tool results ride as
  // user messages containing tool_result blocks.
  const messages: Record<string, unknown>[] = [];
  for (const m of a.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant" && m.toolCalls?.length)
      messages.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: safeJson(t.args) })),
        ],
      });
    else if (m.role === "assistant") messages.push({ role: "assistant", content: m.content });
    else if (m.role === "tool")
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      });
  }

  const body: Record<string, unknown> = {
    model: a.model,
    max_tokens: 4096,
    stream: true,
    messages,
  };
  if (a.system) body.system = a.system;
  if (a.tools?.length)
    body.tools = a.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  const res = await fetch(`${trimBase(a.base)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": a.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: a.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`provider HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  let text = "";
  let stop: StreamResult["stopReason"] = "endturn";
  const toolAcc = new Map<string, { id: string; name: string; args: string }>();
  let currentTool: string | null = null;

  await readSse(res, (data) => {
    let j: {
      type?: string;
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      content_block?: { type?: string; id?: string; name?: string };
      index?: number;
    };
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
      currentTool = j.content_block.id ?? `tool_${j.index ?? 0}`;
      toolAcc.set(currentTool, { id: j.content_block.id ?? currentTool, name: j.content_block.name ?? "", args: "" });
    } else if (j.type === "content_block_delta" && j.delta) {
      if (j.delta.type === "text_delta" && j.delta.text) {
        text += j.delta.text;
        a.onDelta(j.delta.text);
      } else if (j.delta.type === "input_json_delta" && currentTool && j.delta.partial_json) {
        const acc = toolAcc.get(currentTool)!;
        acc.args += j.delta.partial_json;
      }
    } else if (j.type === "message_delta" && j.delta?.stop_reason) {
      stop = j.delta.stop_reason === "tool_use" ? "tool_use" : "endturn";
    }
  });

  return { text, toolCalls: [...toolAcc.values()].filter((t) => t.name), stopReason: stop };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

/* ---------------- shared SSE reader ---------------- */

async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
}

export function streamChat(a: StreamArgs): Promise<StreamResult> {
  return a.protocol === "anthropic" ? streamAnthropic(a) : streamOpenAI(a);
}
