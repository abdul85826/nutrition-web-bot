import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";
import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import nodemailer from "nodemailer";

// Initialize AWS Lex Client
const lexClient = new LexRuntimeV2Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

// Initialize Upstash Redis Client safely
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Multi-Tier Rate Limiter: 5 requests per 60 seconds per IP (sliding window)
const ratelimit = redis
  ? new Ratelimit({
      redis: redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      analytics: true,
      prefix: "ratelimit_chat",
    })
  : null;

// Constant constraints
const HARD_CEILING = 9500;
const TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days TTL

/**
 * Asynchronous Alerting System
 * Dispatches an email notification via Nodemailer without blocking execution.
 */
export async function sendSecurityOrBudgetEmail(subject: string, details: Record<string, unknown>) {
  const user = process.env.ALERT_EMAIL_USER;
  const pass = process.env.ALERT_EMAIL_PASS;
  const to = process.env.ADMIN_RECEIVER_EMAIL;

  if (!user || !pass || !to) {
    console.warn("sendSecurityOrBudgetEmail skipped: ALERT_EMAIL_USER, ALERT_EMAIL_PASS, or ADMIN_RECEIVER_EMAIL not set.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: process.env.ALERT_EMAIL_SERVICE || "gmail",
    auth: { user, pass },
  });

  const formattedDetails = JSON.stringify(details, null, 2);
  const customMessage = typeof details.message === "string" ? details.message : subject;

  await transporter.sendMail({
    from: `"Nutrient Earth Security" <${user}>`,
    to,
    subject,
    text: `${subject}\n\n${customMessage}\n\nTelemetry Details:\n${formattedDetails}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2 style="color: #e11d48;">${subject}</h2>
        <p><strong>${customMessage}</strong></p>
        <pre style="background: #f4f4f5; padding: 14px; border-radius: 8px; font-size: 13px; border: 1px solid #e4e4e7;">${formattedDetails}</pre>
        <p style="font-size: 12px; color: #71717a; margin-top: 20px;">Nutrient Earth Automated Security & Zero-Cost Shield</p>
      </div>
    `,
  });
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; sessionId?: unknown } | null = null;
  try {
    body = (await req.json()) as { text?: unknown; sessionId?: unknown };
  } catch {
    return NextResponse.json(
      { reply: "Invalid payload length.", error: "Malformed JSON payload" },
      { status: 400 }
    );
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;

  // =========================================================================
  // DEFENSIVE TIER 1: Input Length & Content Guard
  // Reject any message where text.length > 250 characters or text.trim().length === 0
  // =========================================================================
  if (text.trim().length === 0 || text.length > 250) {
    return NextResponse.json(
      { reply: "Invalid payload length.", error: "Invalid payload length." },
      { status: 400 }
    );
  }

  // Gracefully verify Redis availability to prevent silent failures or unmetered AWS calls
  if (!redis || !ratelimit) {
    console.error("Upstash Redis is not properly configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
    return NextResponse.json(
      {
        reply: "Service temporarily unavailable. Security layer is initializing. Please try again shortly.",
        error: "Redis credentials not configured",
      },
      { status: 503 }
    );
  }

  // Extract client IP address
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  // Compute monthly global counter key (UTC YYYY-MM)
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthlyKey = `lex_global_usage:${year}-${month}`;

  try {
    // =======================================================================
    // DEFENSIVE TIER 2: Per-IP Sliding Window Rate Limiting (5 req / 60s)
    // =======================================================================
    const rateLimitResult = await ratelimit.limit(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          reply: "Rate limit exceeded. Please wait a moment before sending more messages.",
          error: "Too Many Requests",
        },
        { status: 429 }
      );
    }

    // =======================================================================
    // DEFENSIVE TIER 3: Zero-Cost Monthly Circuit Breaker (AWS Lex Hard Ceiling)
    // =======================================================================
    const currentUsageRaw = await redis.get<number | string>(monthlyKey);
    const currentUsage = Number(currentUsageRaw) || 0;

    if (currentUsage >= HARD_CEILING) {
      // Trigger asynchronous admin warning email (non-blocking)
      const alertSubject = "ALERT: Nutrient Earth monthly free-tier limit reached (9,500/10,000)";
      const alertMessage = "ALERT: Nutrient Earth monthly free-tier limit reached (9,500/10,000). System has safely locked AWS requests to prevent any billing.";

      const alertKey = `lex_alert_sent:${year}-${month}`;
      redis.get(alertKey).then((alreadySent) => {
        if (!alreadySent) {
          redis.set(alertKey, "1", { ex: TTL_SECONDS }).catch(console.error);
          sendSecurityOrBudgetEmail(alertSubject, {
            message: alertMessage,
            currentUsage,
            hardCeiling: HARD_CEILING,
            freeTierTotal: 10000,
            month: `${year}-${month}`,
            timestamp: new Date().toISOString(),
          }).catch((emailErr) => console.error("Async email dispatch error:", emailErr));
        }
      }).catch(console.error);

      return NextResponse.json(
        {
          reply: "Nutrient Earth has reached its free community computation capacity for this month. The calculation engine will automatically reopen on the 1st of next month at 00:00 UTC. Thank you for your support!",
        },
        { status: 200 }
      );
    }

    // =======================================================================
    // EXECUTION: Invoke AWS Lex Client
    // =======================================================================
    const command = new RecognizeTextCommand({
      botId: process.env.LEX_BOT_ID || "MXADRME2AV",
      botAliasId: process.env.LEX_BOT_ALIAS_ID || "TSTALIASID",
      localeId: "en_US",
      sessionId: sessionId || "anon-" + Date.now(),
      text: text,
    });

    const response = await lexClient.send(command);
    const messages = response.messages?.map((m) => m.content).join("\n\n") || "No message returned.";

    // =======================================================================
    // POST-EXECUTION: Increment Monthly Usage Counter & Ensure 35-Day TTL
    // =======================================================================
    const newCount = await redis.incr(monthlyKey);
    if (newCount === 1) {
      await redis.expire(monthlyKey, TTL_SECONDS);
    } else {
      const ttl = await redis.ttl(monthlyKey);
      if (ttl < 0) {
        await redis.expire(monthlyKey, TTL_SECONDS);
      }
    }

    return NextResponse.json({
      reply: messages,
      dialogState: response.sessionState?.dialogAction?.type,
    });
  } catch (error: unknown) {
    console.error("Lex or Security Runtime Error:", error);

    const err = error as { name?: string; message?: string } | undefined;

    // Differentiate between AWS Lex errors and Upstash/Network errors
    if (err?.name === "UpstashError" || err?.message?.includes("Upstash")) {
      return NextResponse.json(
        {
          reply: "Security and rate limit service temporarily unavailable. Please try again shortly.",
          error: "Rate limiting service error",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        reply: "Failed to connect to Lex bot. Please verify AWS credentials or try again later.",
        error: err?.message || "Failed to connect to Lex bot",
      },
      { status: 500 }
    );
  }
}