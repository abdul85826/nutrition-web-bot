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

// Safe Lex client initialization (only when valid credentials exist)
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

// Initialize Upstash Redis Client if configured
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

// Multi-Tier Rate Limiter via Upstash Redis
const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      analytics: true,
      prefix: "ratelimit_chat",
    })
  : null;

// ============================================================================
// IN-MEMORY RESILIENT SECURITY LAYER (Fallback when Redis is unconfigured)
// ============================================================================

interface RateLimitRecord {
  timestamps: number[];
}

const inMemoryRateLimits = new Map<string, RateLimitRecord>();
const inMemoryMonthlyUsage = new Map<string, number>();

// Clean up expired rate-limit IP records every 5 minutes
if (typeof setInterval !== "undefined") {
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of inMemoryRateLimits.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 60000);
      if (record.timestamps.length === 0) {
        inMemoryRateLimits.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function checkInMemoryRateLimit(clientIp: string): {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
} {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 5;

  let record = inMemoryRateLimits.get(clientIp);
  if (!record) {
    record = { timestamps: [] };
    inMemoryRateLimits.set(clientIp, record);
  }

  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const reset = Math.ceil((oldest + windowMs) / 1000);
    return { success: false, limit, remaining: 0, reset };
  }

  record.timestamps.push(now);
  return {
    success: true,
    limit,
    remaining: limit - record.timestamps.length,
    reset: Math.ceil((now + windowMs) / 1000),
  };
}

function incrementInMemoryMonthlyUsage(monthKey: string): number {
  const current = inMemoryMonthlyUsage.get(monthKey) || 0;
  const updated = current + 1;
  inMemoryMonthlyUsage.set(monthKey, updated);
  return updated;
}

function decrementInMemoryMonthlyUsage(monthKey: string): void {
  const current = inMemoryMonthlyUsage.get(monthKey) || 0;
  if (current > 0) {
    inMemoryMonthlyUsage.set(monthKey, current - 1);
  }
}

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

// ============================================================================
// EMBEDDED MIFFLIN-ST JEOR ENGINE (Zero-Failure Fallback when AWS is Unset)
// ============================================================================

interface SessionProfile {
  gender?: "male" | "female";
  age?: number;
  weightKg?: number;
  heightCm?: number;
  activity?: "sedentary" | "light" | "moderate" | "active" | "very_active";
  goal?: "fat loss" | "maintenance" | "muscle gain";
}

const sessionStore = new Map<string, SessionProfile>();

function processLocalNutritionEngine(input: string, sessionId: string): string {
  const lower = input.toLowerCase().trim();
  let profile = sessionStore.get(sessionId);
  if (!profile) {
    profile = {};
    sessionStore.set(sessionId, profile);
  }

  // 1. Detect Gender
  if (/\b(male|man|guy|boy)\b/i.test(lower) && !/\bfemale\b/i.test(lower)) {
    profile.gender = "male";
  } else if (/\b(female|woman|lady|girl)\b/i.test(lower)) {
    profile.gender = "female";
  }

  // 2. Detect Goal
  if (/fat\s*loss|deficit|cut|lose\s*weight|shred/i.test(lower)) {
    profile.goal = "fat loss";
  } else if (/muscle\s*gain|bulk|lean\s*bulk|build\s*muscle|gain\s*mass/i.test(lower)) {
    profile.goal = "muscle gain";
  } else if (/maintain|maintenance|recomp/i.test(lower)) {
    profile.goal = "maintenance";
  }

  // 3. Detect Activity
  if (/sedentary|desk\s*job|no\s*exercise/i.test(lower)) {
    profile.activity = "sedentary";
  } else if (/light|1-3\s*days/i.test(lower)) {
    profile.activity = "light";
  } else if (/moderate|3-5\s*days/i.test(lower)) {
    profile.activity = "moderate";
  } else if (/very\s*active|heavy|intense|athlete/i.test(lower)) {
    profile.activity = "very_active";
  } else if (/active|6-7\s*days/i.test(lower)) {
    profile.activity = "active";
  }

  // 4. Detect Numbers (Age, Weight, Height)
  const ageMatch = lower.match(/\b(\d{1,2})\s*(?:years?|yrs?|yo|age)?\b/);
  if (ageMatch) {
    const val = parseInt(ageMatch[1], 10);
    if (val >= 12 && val <= 100) profile.age = val;
  }

  const weightMatch = lower.match(/\b(\d{2,3}(?:\.\d+)?)\s*(?:kg|kgs?|kilos?)\b/);
  if (weightMatch) {
    profile.weightKg = parseFloat(weightMatch[1]);
  } else {
    const lbsMatch = lower.match(/\b(\d{2,3}(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/);
    if (lbsMatch) profile.weightKg = Math.round(parseFloat(lbsMatch[1]) * 0.453592);
  }

  const heightMatch = lower.match(/\b(\d{2,3})\s*(?:cm|centimeters?)\b/);
  if (heightMatch) {
    profile.heightCm = parseInt(heightMatch[1], 10);
  }

  // If user simply clicks "Calculate my nutrition plan" or starts fresh
  if (/calculate|start|hello|hi|hey/i.test(lower) && !profile.gender) {
    return "Welcome to the Nutrient Earth Mifflin-St Jeor metabolic calculation engine!\n\nTo calculate your targets, please share your details (or tap the quick buttons below):\n• Gender (Male / Female)\n• Age (years)\n• Weight (kg)\n• Height (cm)\n• Activity Level (Sedentary, Light, Moderate)\n• Goal (Fat Loss, Maintenance, Muscle Gain)";
  }

  // Check what is missing
  const missing: string[] = [];
  if (!profile.gender) missing.push("Gender (Male / Female)");
  if (!profile.age) missing.push("Age (e.g., 25 years)");
  if (!profile.weightKg) missing.push("Weight in kg (e.g., 75 kg)");
  if (!profile.heightCm) missing.push("Height in cm (e.g., 178 cm)");
  if (!profile.activity) missing.push("Activity Level (Sedentary, Light, Moderate, Active)");
  if (!profile.goal) missing.push("Goal (Fat Loss, Maintenance, Muscle Gain)");

  if (missing.length > 0) {
    let collectedInfo = "Telemetry recorded so far:\n";
    if (profile.gender) collectedInfo += `• Gender: ${profile.gender.toUpperCase()}\n`;
    if (profile.age) collectedInfo += `• Age: ${profile.age} yrs\n`;
    if (profile.weightKg) collectedInfo += `• Weight: ${profile.weightKg} kg\n`;
    if (profile.heightCm) collectedInfo += `• Height: ${profile.heightCm} cm\n`;
    if (profile.activity) collectedInfo += `• Activity: ${profile.activity}\n`;
    if (profile.goal) collectedInfo += `• Goal: ${profile.goal}\n`;

    return `${collectedInfo}\nPlease provide your remaining detail(s):\n👉 ${missing.join("\n👉 ")}`;
  }

  // All parameters present -> Compute Mifflin-St Jeor formula
  const { gender, age, weightKg, heightCm, activity, goal } = profile;

  // BMR:
  // Men: 10 * weight(kg) + 6.25 * height(cm) - 5 * age + 5
  // Women: 10 * weight(kg) + 6.25 * height(cm) - 5 * age - 161
  const bmr =
    gender === "male"
      ? Math.round(10 * weightKg! + 6.25 * heightCm! - 5 * age! + 5)
      : Math.round(10 * weightKg! + 6.25 * heightCm! - 5 * age! - 161);

  const multipliers: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  const multiplier = multipliers[activity!] || 1.4;
  const tdee = Math.round(bmr * multiplier);

  let targetCalories = tdee;
  if (goal === "fat loss") {
    targetCalories = Math.max(1200, tdee - 500);
  } else if (goal === "muscle gain") {
    targetCalories = tdee + 300;
  }

  // Protein: ~2.0g per kg of bodyweight
  const proteinGrams = Math.round(weightKg! * 2.0);
  const proteinKcal = proteinGrams * 4;

  // Fats: ~25% of total caloric intake (9 kcal/g)
  const fatKcal = Math.round(targetCalories * 0.25);
  const fatGrams = Math.round(fatKcal / 9);

  // Carbs: Remaining calories (4 kcal/g)
  const remainingKcal = Math.max(0, targetCalories - (proteinKcal + fatKcal));
  const carbGrams = Math.round(remainingKcal / 4);

  const waterLiters = (weightKg! * 0.035).toFixed(1);

  return `🎯 Personalized Nutrition & Caloric Targets (Mifflin-St Jeor Engine)

📊 Profile Telemetry:
• Gender: ${gender!.toUpperCase()} | Age: ${age} yrs
• Body Stats: ${weightKg} kg | ${heightCm} cm
• Activity Level: ${activity!.replace("_", " ").toUpperCase()}
• Primary Goal: ${goal!.toUpperCase()}

🔥 Metabolic Benchmarks:
• Basal Metabolic Rate (BMR): ${bmr.toLocaleString()} kcal/day
• Total Daily Energy Expenditure (TDEE): ${tdee.toLocaleString()} kcal/day
• Target Daily Calories: ${targetCalories.toLocaleString()} kcal/day

🥗 Target Daily Macronutrients:
• Protein: ${proteinGrams}g (${proteinKcal} kcal | ${Math.round((proteinKcal / targetCalories) * 100)}%) — Lean mass retention & synthesis
• Healthy Fats: ${fatGrams}g (${fatKcal} kcal | 25%) — Hormonal optimization
• Carbohydrates: ${carbGrams}g (${remainingKcal} kcal | ${Math.round((remainingKcal / targetCalories) * 100)}%) — Glycogen & daily endurance

💧 Daily Hydration Target: ~${waterLiters} Liters water
💡 Tap 'Reset Chat' anytime to recalculate for a new target.`;
}

// ============================================================================
// MAIN POST ROUTE HANDLER
// ============================================================================

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

  // Extract sanitized client IP
  const clientIp = getClientIp(req);

  // Compute monthly global counter key (UTC YYYY-MM)
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthlyKey = `lex_global_usage:${year}-${month}`;

  try {
    // =======================================================================
    // DEFENSIVE TIER 2: Rate Limiting (Redis with in-memory fallback)
    // =======================================================================
    let rateLimitSuccess = true;
    let rateLimitLimit = 5;
    let rateLimitRemaining = 4;
    let rateLimitReset = Math.ceil(Date.now() / 1000) + 60;

    if (ratelimit) {
      const rlResult = await ratelimit.limit(clientIp);
      rateLimitSuccess = rlResult.success;
      rateLimitLimit = rlResult.limit;
      rateLimitRemaining = rlResult.remaining;
      rateLimitReset = rlResult.reset;
    } else {
      const localRl = checkInMemoryRateLimit(clientIp);
      rateLimitSuccess = localRl.success;
      rateLimitLimit = localRl.limit;
      rateLimitRemaining = localRl.remaining;
      rateLimitReset = localRl.reset;
    }

    if (!rateLimitSuccess) {
      return NextResponse.json(
        {
          reply: "Rate limit exceeded. Please wait a moment before sending more messages.",
          error: "Too Many Requests",
        },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": rateLimitLimit.toString(),
            "X-RateLimit-Remaining": rateLimitRemaining.toString(),
            "X-RateLimit-Reset": rateLimitReset.toString(),
          },
        }
      );
    }

    // =======================================================================
    // DEFENSIVE TIER 3: Atomic Zero-Cost Monthly Circuit Breaker
    // =======================================================================
    let newCount = 0;
    if (redis) {
      newCount = await redis.incr(monthlyKey);
      if (newCount === 1) {
        await redis.expire(monthlyKey, TTL_SECONDS);
      }
    } else {
      newCount = incrementInMemoryMonthlyUsage(monthlyKey);
    }

    if (newCount > HARD_CEILING) {
      if (redis) {
        await redis.decr(monthlyKey).catch(() => {});
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
      } else {
        decrementInMemoryMonthlyUsage(monthlyKey);
      }

      return NextResponse.json(
        {
          reply: "Nutrient Earth has reached its free community computation capacity for this month. The calculation engine will automatically reopen on the 1st of next month at 00:00 UTC. Thank you for your support!",
        },
        { status: 200 }
      );
    }

    // =======================================================================
    // EXECUTION: Invoke AWS Lex Client OR Local Engine Fallback
    // =======================================================================
    if (!lexClient) {
      // Graceful local engine response (zero errors, production reliability)
      const localReply = processLocalNutritionEngine(sanitizedText, validSessionId);
      return NextResponse.json({
        reply: localReply,
        dialogState: "ReadyForFulfillment",
      });
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

    if (redis) {
      await redis.decr(monthlyKey).catch(() => {});
    } else {
      decrementInMemoryMonthlyUsage(monthlyKey);
    }

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

    // Fall back to local calculation engine if AWS Lex encounters a network or credential glitch
    try {
      const fallbackReply = processLocalNutritionEngine(sanitizedText, validSessionId);
      return NextResponse.json({
        reply: fallbackReply,
        dialogState: "ReadyForFulfillment",
      });
    } catch {
      return NextResponse.json(
        {
          reply: "Failed to connect to the nutrition calculation service. Please try again in a few moments.",
          error: "Service request failed",
        },
        { status: 500 }
      );
    }
  }
}