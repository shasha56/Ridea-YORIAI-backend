
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type ShiftInput = {
  start_time?: unknown;
  end_time?: unknown;
  car_id?: unknown;
};

type ValidatedShift = {
  car_id: number;
  start_time: string;
  end_time: string;
};

type ValidationResult<T> =
  | { value: T; error?: never }
  | { error: string; value?: never };

const shiftColumns =
  "id, driver_id, car_id, start_time, end_time, status, created_at";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function logDatabaseError(
  operation: string,
  error: {
    code?: string;
    message: string;
    details?: string;
    hint?: string;
  }
) {
  console.error(`[Shift API] ${operation}`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function normalizePositiveInteger(
  value: unknown,
  fieldName: string
): ValidationResult<number> {
  const normalized =
    typeof value === "string" ? Number(value) : value;

  if (
    typeof normalized !== "number" ||
    !Number.isInteger(normalized) ||
    normalized <= 0
  ) {
    return {
      error: `${fieldName} must be a positive integer`,
    };
  }

  return { value: normalized };
}

function parseShiftInput(
  body: unknown
): ValidationResult<ValidatedShift> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: "Request body must be a JSON object",
    };
  }

  const input = body as ShiftInput;

  const carId = normalizePositiveInteger(
    input.car_id,
    "car_id"
  );

  if (carId.error !== undefined) {
    return { error: carId.error };
  }

  if (
    typeof input.start_time !== "string" ||
    typeof input.end_time !== "string"
  ) {
    return {
      error:
        "start_time and end_time are required ISO date strings",
    };
  }

  const startTime = new Date(input.start_time);
  const endTime = new Date(input.end_time);

  if (
    Number.isNaN(startTime.getTime()) ||
    Number.isNaN(endTime.getTime())
  ) {
    return {
      error: "start_time and end_time must be valid dates",
    };
  }

  if (startTime >= endTime) {
    return {
      error: "start_time must be before end_time",
    };
  }

  return {
    value: {
      car_id: carId.value,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    },
  };
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
    return {
      response: jsonError("Authentication is required", 401),
    } as const;
  }

  let supabase;

  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    console.error(
      "[Shift API] Failed to initialize Supabase client"
    );

    return {
      response: jsonError("Server configuration error", 500),
    } as const;
  }

  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);

  if (userError || !userData.user) {
    if (userError) {
      console.error(
        "[Shift API] Authentication failed:",
        userError.message
      );
    }

    return {
      response: jsonError("Invalid access token", 401),
    } as const;
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (driverError) {
    logDatabaseError(
      "Failed to load driver profile",
      driverError
    );

    return {
      response: jsonError(
        "Failed to load driver profile",
        500
      ),
    } as const;
  }

  if (!driver) {
    return {
      response: jsonError(
        "Only registered drivers can manage shifts",
        403
      ),
    } as const;
  }

  return {
    supabase,
    driverId: driver.id,
  } as const;
}

async function hasOverlappingShift(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  driverId: number,
  carId: number,
  startTime: string,
  endTime: string,
  excludedShiftId?: number
) {
  let query = supabase
    .from("shifts")
    .select("id")
    .or(`driver_id.eq.${driverId},car_id.eq.${carId}`)
    .neq("status", "canceled")
    .lt("start_time", endTime)
    .gt("end_time", startTime)
    .limit(1);

  if (excludedShiftId !== undefined) {
    query = query.neq("id", excludedShiftId);
  }

  const { data, error } = await query;

  return {
    overlaps: Boolean(data?.length),
    error,
  };
}

export async function GET(request: Request) {
  const context = await getDriverContext(request);

  if ("response" in context) {
    return context.response;
  }

  const { data, error } = await context.supabase
    .from("shifts")
    .select(shiftColumns)
    .eq("driver_id", context.driverId)
    .order("start_time", { ascending: true });

  if (error) {
    logDatabaseError("Failed to load shifts", error);
    return jsonError("Failed to load shifts", 500);
  }

  return NextResponse.json({ shifts: data });
}

export async function POST(request: Request) {
  const context = await getDriverContext(request);

  if ("response" in context) {
    return context.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseShiftInput(body);

  if (parsed.error !== undefined) {
    return jsonError(parsed.error, 400);
  }

  const overlap = await hasOverlappingShift(
    context.supabase,
    context.driverId,
    parsed.value.car_id,
    parsed.value.start_time,
    parsed.value.end_time
  );

  if (overlap.error) {
    logDatabaseError(
      "Failed to check shift overlap",
      overlap.error
    );

    return jsonError("Failed to check shift overlap", 500);
  }

  if (overlap.overlaps) {
    return jsonError(
      "Shift time overlaps an existing shift for the same driver or vehicle",
      409
    );
  }

  const { data, error } = await context.supabase
    .from("shifts")
    .insert({
      driver_id: context.driverId,
      ...parsed.value,
      status: "available",
    })
    .select(shiftColumns)
    .single();

  if (error) {
    logDatabaseError("Failed to create shift", error);
    return jsonError("Failed to create shift", 500);
  }

  return NextResponse.json(
    { shift: data },
    { status: 201 }
  );
}

export async function PATCH(request: Request) {
  const context = await getDriverContext(request);

  if ("response" in context) {
    return context.response;
  }

  const shiftId = parseShiftId(request);

  if (shiftId === null) {
    return jsonError(
      "A numeric id query parameter is required",
      400
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const parsed = parseShiftInput(body);

  if (parsed.error !== undefined) {
    return jsonError(parsed.error, 400);
  }

  const { data: shift, error: shiftError } =
    await context.supabase
      .from("shifts")
      .select("id, status")
      .eq("id", shiftId)
      .eq("driver_id", context.driverId)
      .maybeSingle();

  if (shiftError) {
    logDatabaseError("Failed to load shift", shiftError);
    return jsonError("Failed to load shift", 500);
  }

  if (!shift) {
    return jsonError("Shift not found", 404);
  }

  if (shift.status !== "available") {
    return jsonError(
      "Only available shifts can be changed",
      409
    );
  }

  const overlap = await hasOverlappingShift(
    context.supabase,
    context.driverId,
    parsed.value.car_id,
    parsed.value.start_time,
    parsed.value.end_time,
    shiftId
  );

  if (overlap.error) {
    logDatabaseError(
      "Failed to check shift overlap",
      overlap.error
    );

    return jsonError("Failed to check shift overlap", 500);
  }

  if (overlap.overlaps) {
    return jsonError(
      "Shift time overlaps an existing shift for the same driver or vehicle",
      409
    );
  }

  const { data, error } = await context.supabase
    .from("shifts")
    .update(parsed.value)
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .select(shiftColumns)
    .single();

  if (error) {
    logDatabaseError("Failed to update shift", error);
    return jsonError("Failed to update shift", 500);
  }

  return NextResponse.json({ shift: data });
}

export async function DELETE(request: Request) {
  const context = await getDriverContext(request);

  if ("response" in context) {
    return context.response;
  }

  const shiftId = parseShiftId(request);

  if (shiftId === null) {
    return jsonError(
      "A numeric id query parameter is required",
      400
    );
  }

  const { data: shift, error: shiftError } =
    await context.supabase
      .from("shifts")
      .select("id, status")
      .eq("id", shiftId)
      .eq("driver_id", context.driverId)
      .maybeSingle();

  if (shiftError) {
    logDatabaseError("Failed to load shift", shiftError);
    return jsonError("Failed to load shift", 500);
  }

  if (!shift) {
    return jsonError("Shift not found", 404);
  }

  if (shift.status !== "available") {
    return jsonError(
      "Only available shifts can be canceled",
      409
    );
  }

  const { data, error } = await context.supabase
    .from("shifts")
    .update({ status: "canceled" })
    .eq("id", shiftId)
    .eq("driver_id", context.driverId)
    .select(shiftColumns)
    .single();

  if (error) {
    logDatabaseError("Failed to cancel shift", error);
    return jsonError("Failed to cancel shift", 500);
  }

  return NextResponse.json({ shift: data });
}
