
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type UnavailableInput = {
  start_time?: unknown;
  end_time?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!accessToken) {
    return jsonError("Authentication is required", 401);
  }

  let supabase;

  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    return jsonError("Server configuration error", 500);
  }

  const { data: userData, error: authError } =
    await supabase.auth.getUser(accessToken);

  if (authError || !userData.user) {
    return jsonError("Invalid access token", 401);
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (driverError) {
    console.error("[Unavailable API] Driver query:", driverError);
    return jsonError("Failed to load driver profile", 500);
  }

  if (!driver) {
    return jsonError("Only registered drivers can manage shifts", 403);
  }

  let body: UnavailableInput;

  try {
    const input: unknown = await request.json();

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return jsonError("Request body must be a JSON object", 400);
    }

    body = input as UnavailableInput;
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  if (
    typeof body.start_time !== "string" ||
    typeof body.end_time !== "string"
  ) {
    return jsonError("start_time and end_time are required", 400);
  }

  const start = new Date(body.start_time);
  const end = new Date(body.end_time);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return jsonError("Invalid date format", 400);
  }

  if (start >= end) {
    return jsonError("start_time must be before end_time", 400);
  }

  const startTime = start.toISOString();
  const endTime = end.toISOString();

  const { data: overlaps, error: overlapError } = await supabase
    .from("shifts")
    .select("id, status")
    .eq("driver_id", driver.id)
    .neq("status", "canceled")
    .lt("start_time", endTime)
    .gt("end_time", startTime)
    .limit(1);

  if (overlapError) {
    console.error(
      "[Unavailable API] Overlap query:",
      overlapError
    );

    return jsonError("Failed to check overlapping shifts", 500);
  }

  if (overlaps && overlaps.length > 0) {
    return jsonError(
      "This period overlaps an existing shift",
      409
    );
  }

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      driver_id: driver.id,
      car_id: null,
      start_time: startTime,
      end_time: endTime,
      status: "unavailable",
    })
    .select(
      "id, driver_id, car_id, start_time, end_time, status, created_at"
    )
    .single();

  if (error) {
    console.error(
      "[Unavailable API] Failed to create unavailable shift:",
      error
    );

    return jsonError("Failed to register unavailable period", 500);
  }

  return NextResponse.json(
    { shift: data },
    { status: 201 }
  );
}
