
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getTargetRange(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utcDate = Date.UTC(year, month - 1, day);
  const validDate = new Date(utcDate);

  if (
    validDate.getUTCFullYear() !== year ||
    validDate.getUTCMonth() !== month - 1 ||
    validDate.getUTCDate() !== day
  ) {
    return null;
  }

  const start = utcDate - JST_OFFSET_MS;

  return {
    start: new Date(start).toISOString(),
    end: new Date(start + DAY_MS).toISOString(),
    deadline:
      utcDate -
      2 * DAY_MS +
      18 * 60 * 60 * 1000 -
      JST_OFFSET_MS,
  };
}

export async function POST(request: Request) {
  const expectedSecret = process.env.MATCHING_CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (
    !expectedSecret ||
    authorization !== `Bearer ${expectedSecret}`
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("date" in body) ||
    typeof body.date !== "string"
  ) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const range = getTargetRange(body.date);

  if (!range) {
    return NextResponse.json(
      { error: "Invalid date" },
      { status: 400 }
    );
  }

  if (Date.now() < range.deadline) {
    return NextResponse.json(
      { error: "Reservation deadline has not passed" },
      { status: 409 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    const [reservationsResult, shiftsResult] =
      await Promise.all([
        supabase
          .from("reservations")
          .select(
            `id,
             passenger_count,
             start_address,
             start_latitude,
             start_longitude,
             end_address,
             end_latitude,
             end_longitude,
             desired_arrival_at`
          )
          .eq("status", "pending")
          .is("trip_id", null)
          .gte("desired_arrival_at", range.start)
          .lt("desired_arrival_at", range.end),

        supabase
          .from("shifts")
          .select(
            `id,
             driver_id,
             car_id,
             start_time,
             end_time,
             status,
             cars (
               id,
               car_name,
               car_capacity
             )`
          )
          .neq("status", "canceled")
          .lt("start_time", range.end)
          .gt("end_time", range.start),
      ]);

    if (reservationsResult.error) {
      console.error(
        "[Matching] Reservations:",
        reservationsResult.error
      );

      return NextResponse.json(
        { error: "Failed to load reservations" },
        { status: 500 }
      );
    }

    if (shiftsResult.error) {
      console.error(
        "[Matching] Shifts:",
        shiftsResult.error
      );

      return NextResponse.json(
        { error: "Failed to load shifts" },
        { status: 500 }
      );
    }

    const shifts = (shiftsResult.data ?? []).filter(
      (shift) =>
        shift.status === "available" &&
        shift.car_id !== null
    );

    return NextResponse.json({
      target_date: body.date,
      reservation_count:
        reservationsResult.data?.length ?? 0,
      shift_count: shifts.length,
      reservations: reservationsResult.data ?? [],
      shifts,
    });
  } catch (error) {
    console.error(
      "[Matching] Unexpected error:",
      error
    );

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
