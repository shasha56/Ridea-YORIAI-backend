import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type ShiftInput = {
  start_time?: unknown;
  end_time?: unknown;
};

const shiftColumns = "id, driver_id, start_time, end_time, status, created_at";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function parseShiftInput(body: unknown) {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" } as const;
  }

  const input = body as ShiftInput;
  if (typeof input.start_time !== "string" || typeof input.end_time !== "string") {
    return { error: "start_time and end_time are required ISO date strings" } as const;
  }

  const startTime = new Date(input.start_time);
  const endTime = new Date(input.end_time);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { error: "start_time and end_time must be valid dates" } as const;
  }
  if (startTime >= endTime) {
    return { error: "start_time must be before end_time" } as const;
  }

  return {
    value: {
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    },
  } as const;
}

function parseShiftId(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }
  return Number(id);
}

async function getDriverContext(request: Request) {
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return { response: jsonError("Authentication is required", 401) } as const;
  }

  let supabase;
  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    return { response: jsonError("Server configuration error", 500) } as const;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return { response: jsonError("Invalid access token", 401) } as const;
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (driverError) {
    return { response: jsonError("Failed to load driver profile", 500) } as const;
  }
  if (!driver) {
    return { response: jsonError("Only registered drivers can manage shifts", 403) } as const;
  }

  return { supabase, driverId: driver.id } as const;
}

async function hasOverlappingShift(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  driverId: number,
  startTime: string,
  endTime: string,
  excludedShiftId?: number,
) {
  let query = supabase
    .from("shifts")
    .select("id")
    .eq("driver_id", driverId)
    .neq("status", "canceled")
    .lt("start_time", endTime)
    .gt("end_time", startTime)
    .limit(1);

  if (excludedShiftId !== undefined) {
    query = query.neq("id", excludedShiftId);
  }

  const { data, error } = await query;
  return { overlaps: Boolean(data?.length), error };
}

export async function GET(request: Request) {
  const context = await getDriverContext(request);
  if ("response" in context) return context.response;

  const { data, error } = await context.supabase
    .from("shifts")
    .select(shiftColumns)
    .eq("driver_id", context.driverId)
    .order("start_time", { ascending: true });

  if (error) return jsonError("Failed to load shifts", 500);
  return NextResponse.json({ shifts: data });
}

export async function POST(request: Request) {
  const context = await getDriverContext(request);
  if ("response" in context) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseShiftInput(body);
  if ("error" in parsed) return jsonError(parsed.error, 400);

  const overlap = await hasOverlappingShift(
    context.supabase,
    context.driverId,
    parsed.value.start_time,
    parsed.value.end_time,
  );
  if (overlap.error) return jsonError("Failed to check shift overlap", 500);
  if (overlap.overlaps) return jsonError("Shift time overlaps an existing shift", 409);

  const { data, error } = await context.supabase
    .from("shifts")
    .insert({
      driver_id: context.driverId,
      ...parsed.value,
      status: "available",
    })
    .select(shiftColumns)
    .single();

  if (error) return jsonError("Failed to create shift", 500);
  return NextResponse.json({ shift: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getDriverContext(request);
  if ("response" in context) return context.response;

  const shiftId = parseShiftId(request);
  if (shiftId === null) return jsonError("A numeric id query parameter is required", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }
  const parsed = parseShiftInput(body);
  if ("error" in parsed) return jsonError(parsed.error, 400);

  const { data: shift, error: shiftError } = await context.supabase
    .from("shifts")
    .select("id, status")
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .maybeSingle();
  if (shiftError) return jsonError("Failed to load shift", 500);
  if (!shift) return jsonError("Shift not found", 404);
  if (shift.status !== "available") {
    return jsonError("Only available shifts can be changed", 409);
  }

  const overlap = await hasOverlappingShift(
    context.supabase,
    context.driverId,
    parsed.value.start_time,
    parsed.value.end_time,
    shiftId,
  );
  if (overlap.error) return jsonError("Failed to check shift overlap", 500);
  if (overlap.overlaps) return jsonError("Shift time overlaps an existing shift", 409);

  const { data, error } = await context.supabase
    .from("shifts")
    .update(parsed.value)
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .select(shiftColumns)
    .single();
  if (error) return jsonError("Failed to update shift", 500);
  return NextResponse.json({ shift: data });
}

export async function DELETE(request: Request) {
  const context = await getDriverContext(request);
  if ("response" in context) return context.response;

  const shiftId = parseShiftId(request);
  if (shiftId === null) return jsonError("A numeric id query parameter is required", 400);

  const { data: shift, error: shiftError } = await context.supabase
    .from("shifts")
    .select("id, status")
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .maybeSingle();
  if (shiftError) return jsonError("Failed to load shift", 500);
  if (!shift) return jsonError("Shift not found", 404);
  if (shift.status !== "available") {
    return jsonError("Only available shifts can be canceled", 409);
  }

  const { data, error } = await context.supabase
    .from("shifts")
    .update({ status: "canceled" })
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .select(shiftColumns)
    .single();
  if (error) return jsonError("Failed to cancel shift", 500);
  return NextResponse.json({ shift: data });
}