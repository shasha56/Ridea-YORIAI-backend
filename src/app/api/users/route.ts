import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ==========================================
// エラーレスポンス
// ==========================================

function errorResponse(
  status: number,
  code: string,
  message: string
) {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

// ==========================================
// Supabase接続
// ==========================================

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// ==========================================
// 利用者情報取得
// GET /api/users?id=UUID
// ==========================================

export async function GET(request: Request) {
  try {
    const supabase = getSupabase();

    if (!supabase) {
      return errorResponse(
        500,
        "SERVER_CONFIGURATION_ERROR",
        "Server configuration is invalid."
      );
    }

    const { searchParams } =
      new URL(request.url);

    const userId =
      searchParams.get("id");

    if (!userId) {
      return errorResponse(
        400,
        "USER_ID_REQUIRED",
        "User ID is required."
      );
    }

    const { data: user, error } =
      await supabase
        .from("users")
        .select(`
          id,
          user_name,
          phone_number,
          profile_image_path,
          address_postcode,
          address,
          role,
          current_latitude,
          current_longitude,
          created_at,
          updated_at
        `)
        .eq("id", userId)
        .single();

    if (error) {
      console.error(
        "User profile fetch failed:",
        error.message
      );

      return errorResponse(
        404,
        "USER_NOT_FOUND",
        "User was not found."
      );
    }

    return Response.json(
      {
        user,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Unexpected user GET error:",
      error
    );

    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "Could not fetch the user."
    );
  }
}

// ==========================================
// 利用者情報編集
// PATCH /api/users
// ==========================================

export async function PATCH(request: Request) {
  try {
    const supabase = getSupabase();

    if (!supabase) {
      return errorResponse(
        500,
        "SERVER_CONFIGURATION_ERROR",
        "Server configuration is invalid."
      );
    }

    const body = await request.json();

    const {
      id,
      user_name,
      phone_number,
      profile_image_path,
      address_postcode,
      address,
    } = body;

    if (!id) {
      return errorResponse(
        400,
        "USER_ID_REQUIRED",
        "User ID is required."
      );
    }

    const updates: Record<string, unknown> = {};

    if (user_name !== undefined) {
      updates.user_name = user_name;
    }

    if (phone_number !== undefined) {
      updates.phone_number =
        phone_number;
    }

    if (profile_image_path !== undefined) {
      updates.profile_image_path =
        profile_image_path;
    }

    if (address_postcode !== undefined) {
      updates.address_postcode =
        address_postcode;
    }

    if (address !== undefined) {
      updates.address = address;
    }

    updates.updated_at =
      new Date().toISOString();

    const { data: updatedUser, error } =
      await supabase
        .from("users")
        .update(updates)
        .eq("id", id)
        .select(`
          id,
          user_name,
          phone_number,
          profile_image_path,
          address_postcode,
          address,
          role,
          current_latitude,
          current_longitude,
          created_at,
          updated_at
        `)
        .single();

    if (error) {
      console.error(
        "User profile update failed:",
        error.message
      );

      return errorResponse(
        500,
        "USER_UPDATE_FAILED",
        "Could not update the user."
      );
    }

    return Response.json(
      {
        user: updatedUser,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Unexpected user PATCH error:",
      error
    );

    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "Could not update the user."
    );
  }
}