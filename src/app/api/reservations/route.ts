
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// 乗車日を日本時間で判定し、指定日数前の18時を取得
function getJstDeadline(
  pickupAt: Date,
  daysBefore: number
): number {
  const jst = new Date(pickupAt.getTime() + JST_OFFSET_MS);

  const pickupDateUtc = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate()
  );

  return (
    pickupDateUtc -
    daysBefore * DAY_MS +
    18 * 60 * 60 * 1000 -
    JST_OFFSET_MS
  );
}

function getAccessToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function POST(request: Request) {
  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return jsonError("Authentication is required", 401);
  }

  let supabase;

  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    return jsonError("Server configuration error", 500);
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return jsonError("Invalid access token", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Request body must be an object", 400);
  }

  const input = body as Record<string, unknown>;

  const requiredStrings = [
    "start_address",
    "end_address",
    "scheduled_pickup_at",
  ] as const;

  for (const field of requiredStrings) {
    if (
      typeof input[field] !== "string" ||
      !input[field].trim()
    ) {
      return jsonError(`${field} is required`, 400);
    }
  }

  const passengerCount = input.passenger_count;

  if (
    typeof passengerCount !== "number" ||
    !Number.isInteger(passengerCount) ||
    passengerCount < 1
  ) {
    return jsonError("Invalid passenger_count", 400);
  }

  const coordinates = [
    ["start_latitude", -90, 90],
    ["start_longitude", -180, 180],
    ["end_latitude", -90, 90],
    ["end_longitude", -180, 180],
  ] as const;

  for (const [field, min, max] of coordinates) {
    const value = input[field];

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      return jsonError(`Invalid ${field}`, 400);
    }
  }

  const pickupAt = new Date(
    input.scheduled_pickup_at as string
  );

  if (Number.isNaN(pickupAt.getTime())) {
    return jsonError("Invalid scheduled_pickup_at", 400);
  }

  // 予約期限：乗車日の2日前18時（日本時間）
  const reservationDeadline = getJstDeadline(pickupAt, 2);

  if (Date.now() >= reservationDeadline) {
    return jsonError("Reservation deadline has passed", 409);
  }

  const reservation = {
    user_id: authData.user.id,
    passenger_count: passengerCount,
    start_address: (input.start_address as string).trim(),
    start_latitude: input.start_latitude,
    start_longitude: input.start_longitude,
    end_address: (input.end_address as string).trim(),
    end_latitude: input.end_latitude,
    end_longitude: input.end_longitude,
    scheduled_pickup_at: pickupAt.toISOString(),
    status: "pending",
    shift_id: null,
  };

  const { data, error } = await supabase
    .from("reservations")
    .insert(reservation)
    .select()
    .single();

  if (error) {
    console.error("Reservation creation failed:", error.message);
    return jsonError("Failed to create reservation", 500);
  }

  return NextResponse.json(
    { reservation: data },
    { status: 201 }
  );
}

export async function GET(request: Request) {
  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return jsonError("Authentication is required", 401);
  }

  let supabase;

  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    return jsonError("Server configuration error", 500);
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return jsonError("Invalid access token", 401);
  }

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("user_id", authData.user.id)
    .order("scheduled_pickup_at", { ascending: true });

  if (error) {
    console.error("Failed to load reservations:", error.message);
    return jsonError("Failed to load reservations", 500);
  }

  return NextResponse.json({ reservations: data });
}

export async function DELETE(request: Request) {
  const accessToken = getAccessToken(request);

  if (!accessToken) {
    return jsonError("Authentication is required", 401);
  }

  let supabase;

  try {
    supabase = createSupabaseServerClient(accessToken);
  } catch {
    return jsonError("Server configuration error", 500);
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return jsonError("Invalid access token", 401);
  }

  const id = new URL(request.url).searchParams.get("id");

  if (!id || !/^[1-9]\d*$/.test(id)) {
    return jsonError("Valid reservation ID is required", 400);
  }

  const { data: reservation, error: fetchError } =
    await supabase
      .from("reservations")
      .select("id, status, scheduled_pickup_at")
      .eq("id", Number(id))
      .eq("user_id", authData.user.id)
      .maybeSingle();

  if (fetchError) {
    console.error("Failed to load reservation:", fetchError.message);
    return jsonError("Failed to load reservation", 500);
  }

  if (!reservation) {
    return jsonError("Reservation not found", 404);
  }

  if (
    reservation.status !== "pending" &&
    reservation.status !== "accepted"
  ) {
    return jsonError("Reservation cannot be canceled", 409);
  }

  // キャンセル期限：乗車日の前日18時（日本時間）
  const cancellationDeadline = getJstDeadline(
    new Date(reservation.scheduled_pickup_at),
    1
  );

  if (Date.now() >= cancellationDeadline) {
    return jsonError("Cancellation deadline has passed", 409);
  }

  const { data, error } = await supabase
    .from("reservations")
    .update({ status: "canceled" })
    .eq("id", Number(id))
    .eq("user_id", authData.user.id)
    .in("status", ["pending", "accepted"])
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to cancel reservation:", error.message);
    return jsonError("Failed to cancel reservation", 500);
  }

  if (!data) {
    return jsonError("Reservation status has changed", 409);
  }

  return NextResponse.json({
    message: "Reservation canceled successfully",
    reservation: data,
  });
}
