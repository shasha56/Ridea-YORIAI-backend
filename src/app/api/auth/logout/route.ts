import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return errorResponse(
      401,
      "AUTHENTICATION_REQUIRED",
      "A valid Bearer access token is required.",
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase logout environment variables are not configured.");
    return errorResponse(500, "SERVER_CONFIGURATION_ERROR", "Server configuration is invalid.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { error } = await supabase.auth.admin.signOut(accessToken, "local");

    if (error) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
      }

      console.error("Supabase Auth logout failed:", error.message);
      return errorResponse(500, "LOGOUT_FAILED", "Could not sign out.");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(
      "Unexpected Supabase Auth logout error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return errorResponse(500, "LOGOUT_FAILED", "Could not sign out.");
  }
}
