import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";
import { NextResponse } from "next/server";

const lexClient = new LexRuntimeV2Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const { text, sessionId } = await req.json();

    const command = new RecognizeTextCommand({
      botId: process.env.LEX_BOT_ID || "MXADRME2AV",
      botAliasId: process.env.LEX_BOT_ALIAS_ID || "TSTALIASID",
      localeId: "en_US",
      sessionId: sessionId || "anon-" + Date.now(),
      text: text,
    });

    const response = await lexClient.send(command);
    const messages = response.messages?.map((m) => m.content).join("\n\n") || "No message returned.";

    return NextResponse.json({ reply: messages, dialogState: response.sessionState?.dialogAction?.type });
  } catch (error: any) {
    console.error("Lex runtime error:", error);
    return NextResponse.json({ error: error.message || "Failed to connect to Lex bot" }, { status: 500 });
  }
}