import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";
import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import nodemailer from "nodemailer";

// ============================================================================
// ENVIRONMENT & CREDENTIAL INITIALIZATION
// ============================================================================

const awsRegion = process.env.AWS_REGION || "ap-southeast-1";
const awsAccessKey = process.env.AWS_ACCESS_KEY_ID || "";
const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY || "";
const awsSessionToken = process.env.AWS_SESSION_TOKEN;

const isAwsConfigured =
  Boolean(awsAccessKey) &&
  Boolean(awsSecretKey) &&
  !awsAccessKey.includes("your_aws_access_key");

// Lazy or safe Lex client initialization
const lexClient = isAwsConfigured
  ? new LexRuntimeV2Client({
      region: awsRegion,
      credentials: {
        accessKeyId: awsAccessKey,
        secretAccessKey: awsSecretKey,
        ...(awsSessionToken ? { sessionToken: awsSessionToken } : {}),
      },
    })
  : null;

// Initialize Upstash Redis Client safely
const isRedisConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes("your-upstash-redis")
);

const redis = isRedisConfigured
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Multi-Tier Rate Limiter: 5 requests per 60 seconds per IP (sliding window)
const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      analytics: true,
      prefix: "ratelimit_chat",
    })
  : null;

// Constant constraints
const HARD_CEILING = 9500;
const TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days TTL
const LEX_CALL_TIMEOUT_MS = 8000;
const SAFE_SESSION_REGEX = /^[0-9a-zA-Z._:-]{2,100}$/;

/**
 * Escapes HTML characters to prevent HTML/XSS injection in automated emails.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Extracts and sanitizes client IP address to prevent header injection or spoofing.
 */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  let candidate = forwarded ? forwarded.split(",")[0].trim() : "";
  if (!candidate) {
    candidate =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
  }
  const cleanIp = candidate.replace(/[^a-fA-F0-9:.]/g, "").slice(0, 45);
  return cleanIp || "127.0.0.1";
}

/**
 * Asynchronous Alerting System
 * Dispatches an email notification via Nodemailer without blocking execution.
 */
export async function sendSecurityOrBudgetEmail(subject: string, details: Record<string, unknown>) {
  const user = process.env.ALERT_EMAIL_USER;
  const pass = process.env.ALERT_EMAIL_PASS;
  const to = process.env.ADMIN_RECEIVER_EMAIL;

  if (!user || !pass || !to || user.includes("example.com")) {
    console.warn("sendSecurityOrBudgetEmail skipped: Mail credentials not fully configured.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: process.env.ALERT_EMAIL_SERVICE || "gmail",
      auth: { user, pass },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });

    const formattedDetails = JSON.stringify(details, null, 2);
    const customMessage = typeof details.message === "string" ? details.message : subject;

    const safeSubject = escapeHtml(subject);
    const safeCustomMessage = escapeHtml(customMessage);
    const safeDetails = escapeHtml(formattedDetails);

    await transporter.sendMail({
      from: `"Nutrient Earth Security" <${user}>`,
      to,
      subject,
      text: `${subject}\n\n${customMessage}\n\nTelemetry Details:\n${formattedDetails}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
          <h2 style="color: #e11d48;">${safeSubject}</h2>
          <p><strong>${safeCustomMessage}</strong></p>
          <pre style="background: #f4f4f5; padding: 14px; border-radius: 8px; font-size: 13px; border: 1px solid #e4e4e7;">${safeDetails}</pre>
          <p style="font-size: 12px; color: #71717a; margin-top: 20px;">Nutrient Earth Automated Security & Zero-Cost Shield</p>
        </div>
      `,
    });
  } catch (mailErr) {
    console.error("sendSecurityOrBudgetEmail execution error:", mailErr);
  }
}

export async function POST(req: NextRequest) {
  // =========================================================================
  // DEFENSIVE TIER 0: Anti-CSRF Origin Validation
  // =========================================================================
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { reply: "Forbidden origin.", error: "Cross-origin request blocked." },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { reply: "Invalid request origin.", error: "Malformed origin header." },
        { status: 400 }
      );
    }
  }

  // =========================================================================
  // DEFENSIVE TIER 1: Payload Parsing & Strict Content Sanitization
  // =========================================================================
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { reply: "Unsupported media type.", error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }

  let body: { text?: unknown; sessionId?: unknown } | null = null;
  try {
    body = (await req.json()) as { text?: unknown; sessionId?: unknown };
  } catch {
    return NextResponse.json(
      { reply: "Malformed JSON payload.", error: "Invalid JSON format." },
      { status: 400 }
    );
  }

  const rawText = typeof body?.text === "string" ? body.text : "";
  // Strip control characters & null bytes
  const sanitizedText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();

  if (sanitizedText.length === 0 || sanitizedText.length > 250) {
    return NextResponse.json(
      { reply: "Message must be between 1 and 250 characters.", error: "Invalid payload length." },
      { status: 400 }
    );
  }

  const rawSessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const validSessionId =
    rawSessionId && SAFE_SESSION_REGEX.test(rawSessionId)
      ? rawSessionId
      : `anon-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

  // Gracefully verify Redis configuration to prevent unmetered AWS calls
  if (!redis || !ratelimit) {
    console.error("Upstash Redis is not properly configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
    return NextResponse.json(
      {
        reply: "Service temporarily unavailable. Security layer is initializing. Please try again shortly.",
        error: "Rate limiting service unconfigured",
      },
      { status: 503 }
    );
  }

  // Extract sanitized client IP
  const clientIp = getClientIp(req);

  // Compute monthly global counter key (UTC YYYY-MM)
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthlyKey = `lex_global_usage:${year}-${month}`;

  try {
    // =======================================================================
    // DEFENSIVE TIER 2: Per-IP Sliding Window Rate Limiting (5 req / 60s)
    // =======================================================================
    const rateLimitResult = await ratelimit.limit(clientIp);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          reply: "Rate limit exceeded. Please wait a moment before sending more messages.",
          error: "Too Many Requests",
        },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": rateLimitResult.limit.toString(),
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.reset.toString(),
          },
        }
      );
    }

    // =======================================================================
    // DEFENSIVE TIER 3: Atomic Zero-Cost Monthly Circuit Breaker
    // Pre-allocate quota atomically to eliminate concurrent race condition bypasses
    // =======================================================================
    const newCount = await redis.incr(monthlyKey);
    if (newCount === 1) {
      await redis.expire(monthlyKey, TTL_SECONDS);
    }

    if (newCount > HARD_CEILING) {
      // Revert counter so blocked requests don't keep inflating usage
      await redis.decr(monthlyKey).catch(() => {});

      // Send atomic alert once per month using SET ... NX
      const alertKey = `lex_alert_sent:${year}-${month}`;
      const alertAcquired = await redis.set(alertKey, "1", { nx: true, ex: TTL_SECONDS });
      if (alertAcquired) {
        sendSecurityOrBudgetEmail(
          "ALERT: Nutrient Earth monthly free-tier limit reached (9,500/10,000)",
          {
            message: "Nutrient Earth monthly limit reached. System locked AWS requests to prevent billing.",
            currentUsage: newCount,
            hardCeiling: HARD_CEILING,
            freeTierTotal: 10000,
            month: `${year}-${month}`,
            timestamp: new Date().toISOString(),
          }
        ).catch((emailErr) => console.error("Async budget alert error:", emailErr));
      }

      return NextResponse.json(
        {
          reply: "Nutrient Earth has reached its free community computation capacity for this month. The calculation engine will automatically reopen on the 1st of next month at 00:00 UTC. Thank you for your support!",
        },
        { status: 200 }
      );
    }

    // =======================================================================
    // EXECUTION: Invoke AWS Lex Client with Timeout Protection
    // =======================================================================
    if (!lexClient) {
      // Decrement back quota if AWS client is unconfigured
      await redis.decr(monthlyKey).catch(() => {});
      console.error("AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.");
      return NextResponse.json(
        {
          reply: "Calculation engine is currently offline for scheduled maintenance. Please check back soon.",
          error: "AWS Lex service not configured",
        },
        { status: 503 }
      );
    }

    const command = new RecognizeTextCommand({
      botId: process.env.LEX_BOT_ID || "MXADRME2AV",
      botAliasId: process.env.LEX_BOT_ALIAS_ID || "TSTALIASID",
      localeId: "en_US",
      sessionId: validSessionId,
      text: sanitizedText,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AWS Lex request timed out")), LEX_CALL_TIMEOUT_MS)
    );

    const response = await Promise.race([lexClient.send(command), timeoutPromise]);

    const messages =
      response.messages
        ?.map((m) => m.content?.trim())
        .filter(Boolean)
        .join("\n\n") || "No message returned.";

    return NextResponse.json({
      reply: messages,
      dialogState: response.sessionState?.dialogAction?.type,
    });
  } catch (error: unknown) {
    console.error("Lex or Security Runtime Error:", error);

    // Rollback consumed quota on AWS runtime failure so user quota isn't burned
    await redis.decr(monthlyKey).catch(() => {});

    const err = error as { name?: string; message?: string } | undefined;

    if (err?.name === "UpstashError" || err?.message?.includes("Upstash")) {
      return NextResponse.json(
        {
          reply: "Security and rate limit service temporarily unavailable. Please try again shortly.",
          error: "Rate limiting service error",
        },
        { status: 503 }
      );
    }

    // Never leak raw AWS/server internals (CWE-209 prevention)
    return NextResponse.json(
      {
        reply: "Failed to connect to the nutrition calculation service. Please try again in a few moments.",
        error: "Service request failed",
      },
      { status: 500 }
    );
  }
}