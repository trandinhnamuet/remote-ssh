import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Kênh nhắn tin đơn giản, không xác thực — chỉ để 2 phiên Claude Code CLI (trên 2 máy
// khác nhau) trao đổi log/thông tin debug qua HTTP thay vì copy-paste tay.
const FILE = path.join(process.cwd(), ".data", "messages.json");
const MAX_MESSAGES = 500;

type Msg = { id: number; from: string; text: string; time: string };

function readMessages(): Msg[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeMessages(messages: Msg[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(messages));
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const since = Number(request.nextUrl.searchParams.get("since") || 0);
  const messages = readMessages().filter((m) => m.id > since);

  if (request.nextUrl.searchParams.has("text")) {
    const body = messages
      .map((m) => `#${m.id} [${m.time}] ${m.from}: ${m.text}`)
      .join("\n");
    return new NextResponse(body + (body ? "\n" : ""), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const text = String(body.text ?? "").slice(0, 20000);
  const from = String(body.from ?? "unknown").slice(0, 100);
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const messages = readMessages();
  const id = messages.length ? messages[messages.length - 1].id + 1 : 1;
  const msg: Msg = { id, from, text, time: new Date().toISOString() };
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  writeMessages(messages);

  return NextResponse.json({ ok: true, message: msg });
}

export async function DELETE() {
  writeMessages([]);
  return NextResponse.json({ ok: true });
}
