import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RegistrationInput = {
  email: string;
  password: string;
  userName: string;
  phoneNumber: string | null;
  profileImagePath: string | null;
  addressPostcode: string | null;
  address: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
};

const allowedFields = new Set([
  "email",
  "password",
  "user_name",
  "phone_number",
  "profile_image_path",
  "address_postcode",
  "address",
  "current_latitude",
  "current_longitude",
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | null | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function parseInput(body: unknown):
  | { value: RegistrationInput }
  | { error: string } {
  if (!isRecord(body)) return { error: "Request body must be a JSON object." };

  const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unknownField) return { error: `Unknown field: ${unknownField}` };

  if (typeof body.email !== "string") return { error: "email is required." };
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email)) {
    return { error: "email must be a valid email address." };
  }

  if (typeof body.password !== "string") {
    return { error: "password is required." };
  }
  if (body.password.length < 8 || body.password.length > 72) {
    return { error: "password must be between 8 and 72 characters." };
  }

  if (typeof body.user_name !== "string") {
    return { error: "user_name is required." };
  }
  const userName = body.user_name.trim();
  if (userName.length === 0 || userName.length > 100) {
    return { error: "user_name must be between 1 and 100 characters." };
  }

  const phoneNumber = optionalString(body, "phone_number", 32);
  const profileImagePath = optionalString(body, "profile_image_path", 2048);
  const addressPostcode = optionalString(body, "address_postcode", 16);
  const address = optionalString(body, "address", 500);
  if (
    phoneNumber === undefined ||
    profileImagePath === undefined ||
    addressPostcode === undefined ||
    address === undefined
  ) {
    return { error: "An optional text field has an invalid value or is too long." };
  }

  const latitude = body.current_latitude;
  const longitude = body.current_longitude;
  const hasLatitude = latitude !== undefined && latitude !== null;
  const hasLongitude = longitude !== undefined && longitude !== null;
  if (hasLatitude !== hasLongitude) {
    return { error: "current_latitude and current_longitude must be provided together." };
  }
  if (
    (hasLatitude &&
      (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (hasLongitude &&
      (typeof longitude !== "number" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180))
  ) {
    return { error: "current_latitude or current_longitude is out of range." };
  }

  return {
    value: {
      email,
      password: body.password,
      userName,
      phoneNumber,
      profileImagePath,
      addressPostcode,
      address,
      currentLatitude: hasLatitude ? (latitude as number) : null,
      currentLongitude: hasLongitude ? (longitude as number) : null,
    },
  };
}

function isDuplicateAuthUser(error: { code?: string; message: string }) {
  return (
    error.code === "email_exists" ||
    error.message.toLowerCase().includes("already")
  );
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase server environment variables are not configured.");
    return errorResponse(500, "SERVER_CONFIGURATION_ERROR", "Server configuration is invalid.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const input = parsed.value;

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });

  if (authError) {
    if (isDuplicateAuthUser(authError)) {
      return errorResponse(409, "EMAIL_ALREADY_REGISTERED", "This email address is already registered.");
    }
    console.error("Supabase Auth user creation failed:", authError.message);
    return errorResponse(500, "AUTH_USER_CREATION_FAILED", "Could not create the user account.");
  }

  const profile = {
    id: authData.user.id,
    user_name: input.userName,
    phone_number: input.phoneNumber,
    profile_image_path: input.profileImagePath,
    address_postcode: input.addressPostcode,
    address: input.address,
    role: "passenger" as const,
    current_latitude: input.currentLatitude,
    current_longitude: input.currentLongitude,
  };

  const { data: createdProfile, error: profileError } = await supabase
    .from("users")
    .insert(profile)
    .select(
      "id,user_name,phone_number,profile_image_path,address_postcode,address,role,current_latitude,current_longitude,created_at,updated_at",
    )
    .single();

  if (profileError) {
    const { error: cleanupError } = await supabase.auth.admin.deleteUser(authData.user.id);
    if (cleanupError) {
      console.error("Auth user cleanup failed after profile creation error:", cleanupError.message);
    }
    console.error("Public user profile creation failed:", profileError.message);
    return errorResponse(500, "PROFILE_CREATION_FAILED", "Could not create the user profile.");
  }

  return Response.json({ user: createdProfile }, { status: 201 });
}
