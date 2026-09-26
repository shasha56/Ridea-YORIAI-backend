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
  const supabaseUrl =
    process.env.SUPABASE_URL;

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
// ドライバー情報取得
// GET /api/drivers?id=1
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

    const driverId =
      searchParams.get("id");

    if (!driverId) {
      return errorResponse(
        400,
        "DRIVER_ID_REQUIRED",
        "Driver ID is required."
      );
    }

    // driversテーブルから取得
    const {
      data: driver,
      error: driverError,
    } = await supabase
      .from("drivers")
      .select(`
        id,
        user_id,
        driver_license_image_path,
        created_at
      `)
      .eq("id", driverId)
      .single();

    if (driverError) {
      console.error(
        "Driver fetch failed:",
        driverError.message
      );

      return errorResponse(
        404,
        "DRIVER_NOT_FOUND",
        "Driver was not found."
      );
    }

    // driverに紐づいているusers情報取得
    const {
      data: user,
      error: userError,
    } = await supabase
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
        current_longitude
      `)
      .eq("id", driver.user_id)
      .single();

    if (userError) {
      console.error(
        "Driver user fetch failed:",
        userError.message
      );

      return errorResponse(
        500,
        "DRIVER_USER_FETCH_FAILED",
        "Could not fetch driver user information."
      );
    }

    return Response.json(
      {
        driver: {
          id: driver.id,

          user_id:
            driver.user_id,

          user_name:
            user.user_name,

          phone_number:
            user.phone_number,

          profile_image_path:
            user.profile_image_path,

          address_postcode:
            user.address_postcode,

          address:
            user.address,

          current_latitude:
            user.current_latitude,

          current_longitude:
            user.current_longitude,

          driver_license_image_path:
            driver.driver_license_image_path,

          created_at:
            driver.created_at,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Unexpected driver GET error:",
      error
    );

    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "Could not fetch the driver."
    );
  }
}

// ==========================================
// ドライバー情報編集
// PATCH /api/drivers
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

    const body =
      await request.json();

    const {
      id,
      user_name,
      phone_number,
      profile_image_path,
      address_postcode,
      address,
      driver_license_image_path,
    } = body;

    if (!id) {
      return errorResponse(
        400,
        "DRIVER_ID_REQUIRED",
        "Driver ID is required."
      );
    }

    // ========================================
    // driverからuser_idを取得
    // ========================================

    const {
      data: driver,
      error: driverError,
    } = await supabase
      .from("drivers")
      .select("id,user_id")
      .eq("id", id)
      .single();

    if (driverError) {
      return errorResponse(
        404,
        "DRIVER_NOT_FOUND",
        "Driver was not found."
      );
    }

    // ========================================
    // usersテーブル更新
    // ========================================

    const userUpdates: Record<
      string,
      unknown
    > = {};

    if (user_name !== undefined) {
      userUpdates.user_name =
        user_name;
    }

    if (phone_number !== undefined) {
      userUpdates.phone_number =
        phone_number;
    }

    if (profile_image_path !== undefined) {
      userUpdates.profile_image_path =
        profile_image_path;
    }

    if (address_postcode !== undefined) {
      userUpdates.address_postcode =
        address_postcode;
    }

    if (address !== undefined) {
      userUpdates.address =
        address;
    }

    userUpdates.updated_at =
      new Date().toISOString();

    const {
      data: updatedUser,
      error: userError,
    } = await supabase
      .from("users")
      .update(userUpdates)
      .eq("id", driver.user_id)
      .select()
      .single();

    if (userError) {
      console.error(
        "Driver user update failed:",
        userError.message
      );

      return errorResponse(
        500,
        "DRIVER_USER_UPDATE_FAILED",
        "Could not update driver user information."
      );
    }

    // ========================================
    // driversテーブル更新
    // ========================================

    let updatedDriver;

    if (
      driver_license_image_path !==
      undefined
    ) {
      const {
        data,
        error,
      } = await supabase
        .from("drivers")
        .update({
          driver_license_image_path,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return errorResponse(
          500,
          "DRIVER_UPDATE_FAILED",
          "Could not update driver information."
        );
      }

      updatedDriver = data;
    } else {
      const { data, error } =
        await supabase
          .from("drivers")
          .select("*")
          .eq("id", id)
          .single();

      if (error) {
        return errorResponse(
          500,
          "DRIVER_FETCH_FAILED",
          "Could not fetch driver information."
        );
      }

      updatedDriver = data;
    }

    return Response.json(
      {
        driver: {
          ...updatedDriver,
          user: updatedUser,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "Unexpected driver PATCH error:",
      error
    );

    return errorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "Could not update the driver."
    );
  }
}