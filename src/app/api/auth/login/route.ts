import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type LoginInput = { email: string; password: string };
const allowedFields = new Set(["email", "password"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInput(body: unknown): { value: LoginInput } | { error: string } {
  if (!isRecord(body)) return { error: "Request body must be a JSON object." };
  const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unknownField) return { error: `Unknown field: ${unknownField}` };
  if (typeof body.email !== "string") return { error: "email is required." };

  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) {
    return { error: "email must be a valid email address." };
  }
  if (typeof body.password !== "string") return { error: "password is required." };
  if (body.password.length < 8 || body.password.length > 72) {
    return { error: "password must be between 8 and 72 characters." };
  }
  return { value: { email, password: body.password } };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = parseInput(body);
  if ("error" in parsed) {
    return errorResponse(422, "VALIDATION_ERROR", parsed.error);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error("Supabase login environment variables are not configured.");
    return errorResponse(500, "SERVER_CONFIGURATION_ERROR", "Server configuration is invalid.");
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data, error } = await supabase.auth.signInWithPassword(parsed.value);
    if (error) {
      if (error.code === "email_not_confirmed") {
        return errorResponse(403, "EMAIL_NOT_CONFIRMED", "Email address has not been confirmed.");
      }
      if (error.code === "invalid_credentials") {
        return errorResponse(401, "INVALID_CREDENTIALS", "Email address or password is incorrect.");
      }
      console.error("Supabase Auth login failed:", error.message);
      return errorResponse(500, "LOGIN_FAILED", "Could not sign in.");
    }
    if (!data.session) {
      console.error("Supabase Auth login succeeded without a session.");
      return errorResponse(500, "SESSION_CREATION_FAILED", "Could not create an authentication session.");
    }

    return Response.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at,
        token_type: data.session.token_type,
      },
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (error) {
    console.error(
      "Unexpected Supabase Auth login error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return errorResponse(500, "LOGIN_FAILED", "Could not sign in.");
  }
}
