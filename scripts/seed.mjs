import { createClient } from "@supabase/supabase-js";

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const seedPassword = requiredEnv("SEED_USER_PASSWORD");

if (seedPassword.length < 8) {
  throw new Error("SEED_USER_PASSWORD must be at least 8 characters");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const USERS = [
  {
    key: "driverA",
    email: "driver.a@example.test",
    user_name: "Seed Driver A",
    phone_number: "09000000001",
    profile_image_path: "seed/profiles/driver-a.png",
    address_postcode: "100-0001",
    address: "東京都千代田区千代田1-1",
    role: "driver",
    current_latitude: 35.681236,
    current_longitude: 139.767125,
  },
  {
    key: "driverB",
    email: "driver.b@example.test",
    user_name: "Seed Driver B",
    phone_number: "09000000002",
    profile_image_path: "seed/profiles/driver-b.png",
    address_postcode: "160-0022",
    address: "東京都新宿区新宿3-38-1",
    role: "driver",
    current_latitude: 35.689607,
    current_longitude: 139.700571,
  },
  {
    key: "passengerA",
    email: "passenger.a@example.test",
    user_name: "Seed Passenger A",
    phone_number: "09000000011",
    profile_image_path: "seed/profiles/passenger-a.png",
    address_postcode: "150-0002",
    address: "東京都渋谷区渋谷2-24-12",
    role: "passenger",
    current_latitude: 35.658034,
    current_longitude: 139.701636,
  },
  {
    key: "passengerB",
    email: "passenger.b@example.test",
    user_name: "Seed Passenger B",
    phone_number: "09000000012",
    profile_image_path: "seed/profiles/passenger-b.png",
    address_postcode: "150-0043",
    address: "東京都渋谷区道玄坂1-1-1",
    role: "passenger",
    current_latitude: 35.658517,
    current_longitude: 139.701334,
  },
  {
    key: "passengerC",
    email: "passenger.c@example.test",
    user_name: "Seed Passenger C",
    phone_number: "09000000013",
    profile_image_path: "seed/profiles/passenger-c.png",
    address_postcode: "108-0075",
    address: "東京都港区港南2-14-10",
    role: "passenger",
    current_latitude: 35.628471,
    current_longitude: 139.73876,
  },
  {
    key: "passengerD",
    email: "passenger.d@example.test",
    user_name: "Seed Passenger D",
    phone_number: "09000000014",
    profile_image_path: "seed/profiles/passenger-d.png",
    address_postcode: "110-0005",
    address: "東京都台東区上野7-1-1",
    role: "passenger",
    current_latitude: 35.713768,
    current_longitude: 139.777254,
  },
];

const CARS = [
  { key: "carA", car_name: "Seed Minivan", car_number: "品川500あ1001", car_capacity: 5 },
  { key: "carB", car_name: "Seed Sedan", car_number: "練馬300い2002", car_capacity: 4 },
];

const ROUTE = {
  start_address: "東京駅丸の内中央口",
  start_latitude: 35.681236,
  start_longitude: 139.767125,
  end_address: "羽田空港第1ターミナル",
  end_latitude: 35.549393,
  end_longitude: 139.779839,
};

const TIMES = {
  sharedPickup: "2030-01-15T00:30:00.000Z",
  sharedStart: "2030-01-15T00:00:00.000Z",
  sharedEnd: "2030-01-15T02:00:00.000Z",
  canceledStart: "2030-01-15T01:00:00.000Z",
  canceledEnd: "2030-01-15T03:00:00.000Z",
  inProgressPickup: "2030-01-16T00:30:00.000Z",
  inProgressStart: "2030-01-16T00:00:00.000Z",
  inProgressEnd: "2030-01-16T02:00:00.000Z",
  completedPickup: "2026-01-15T00:30:00.000Z",
  completedStart: "2026-01-15T00:00:00.000Z",
  completedEnd: "2026-01-15T02:00:00.000Z",
};

const failOnError = (label, error) => {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
};

async function listAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    failOnError("List Auth users", error);
    users.push(...data.users);
    if (data.users.length < 100) return users;
  }
}

async function ensureAuthUsers() {
  const existing = await listAuthUsers();
  const byEmail = new Map(existing.map((user) => [user.email?.toLowerCase(), user]));
  const ids = {};

  for (const fixture of USERS) {
    let authUser = byEmail.get(fixture.email);
    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: fixture.email,
        password: seedPassword,
        email_confirm: true,
        user_metadata: { seed: true, seed_key: fixture.key },
      });
      failOnError(`Create Auth user ${fixture.email}`, error);
      authUser = data.user;
    } else {
      const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
        password: seedPassword,
        email_confirm: true,
        user_metadata: { ...authUser.user_metadata, seed: true, seed_key: fixture.key },
      });
      failOnError(`Update Auth user ${fixture.email}`, error);
      authUser = data.user;
    }
    ids[fixture.key] = authUser.id;
  }
  return ids;
}

async function ensureOne(table, match, values) {
  let selectQuery = supabase.from(table).select("id").match(match).limit(2);
  const { data: existing, error: selectError } = await selectQuery;
  failOnError(`Find ${table}`, selectError);
  if (existing.length > 1) {
    throw new Error(`${table} seed natural key is not unique: ${JSON.stringify(match)}`);
  }

  if (existing.length === 1) {
    const { data, error } = await supabase
      .from(table)
      .update(values)
      .eq("id", existing[0].id)
      .select("id")
      .single();
    failOnError(`Update ${table}`, error);
    return data.id;
  }

  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  failOnError(`Insert ${table}`, error);
  return data.id;
}

async function ensureShift(match, values) {
  const { data: existing, error: selectError } = await supabase
    .from("shifts")
    .select("id, status")
    .match(match);
  failOnError("Find shifts", selectError);

  const candidates = existing.filter((shift) =>
    values.status === "canceled" ? shift.status === "canceled" : shift.status !== "canceled",
  );
  if (candidates.length > 1) {
    throw new Error(`Shift seed natural key is not unique: ${JSON.stringify(match)}`);
  }

  if (candidates.length === 1) {
    const { data, error } = await supabase
      .from("shifts")
      .update(values)
      .eq("id", candidates[0].id)
      .select("id")
      .single();
    failOnError("Update shifts", error);
    return data.id;
  }

  const { data, error } = await supabase.from("shifts").insert(values).select("id").single();
  failOnError("Insert shifts", error);
  return data.id;
}

async function seedPublicData(userIds) {
  const userRows = USERS.map((fixture) => ({
    id: userIds[fixture.key],
    user_name: fixture.user_name,
    phone_number: fixture.phone_number,
    profile_image_path: fixture.profile_image_path,
    address_postcode: fixture.address_postcode,
    address: fixture.address,
    role: fixture.role,
    current_latitude: fixture.current_latitude,
    current_longitude: fixture.current_longitude,
  }));
  const { error: usersError } = await supabase.from("users").upsert(userRows, { onConflict: "id" });
  failOnError("Upsert public users", usersError);

  const driverIds = {};
  driverIds.driverA = await ensureOne(
    "drivers",
    { user_id: userIds.driverA },
    { user_id: userIds.driverA, driver_license_image_path: "seed/licenses/driver-a.png" },
  );
  driverIds.driverB = await ensureOne(
    "drivers",
    { user_id: userIds.driverB },
    { user_id: userIds.driverB, driver_license_image_path: "seed/licenses/driver-b.png" },
  );

  const carIds = {};
  for (const car of CARS) {
    carIds[car.key] = await ensureOne(
      "cars",
      { car_number: car.car_number },
      { car_name: car.car_name, car_number: car.car_number, car_capacity: car.car_capacity },
    );
  }

  const shiftIds = {};
  const shifts = [
    {
      key: "sharedBooked",
      driver_id: driverIds.driverA,
      car_id: carIds.carA,
      start_time: TIMES.sharedStart,
      end_time: TIMES.sharedEnd,
      status: "booked",
      earnings: null,
    },
    {
      key: "canceledOverlap",
      driver_id: driverIds.driverA,
      car_id: carIds.carA,
      start_time: TIMES.canceledStart,
      end_time: TIMES.canceledEnd,
      status: "canceled",
      earnings: null,
    },
    {
      key: "availableFallback",
      driver_id: driverIds.driverB,
      car_id: carIds.carB,
      start_time: TIMES.sharedStart,
      end_time: TIMES.sharedEnd,
      status: "available",
      earnings: null,
    },
    {
      key: "inProgress",
      driver_id: driverIds.driverB,
      car_id: carIds.carB,
      start_time: TIMES.inProgressStart,
      end_time: TIMES.inProgressEnd,
      status: "booked",
      earnings: null,
    },
    {
      key: "completed",
      driver_id: driverIds.driverA,
      car_id: carIds.carA,
      start_time: TIMES.completedStart,
      end_time: TIMES.completedEnd,
      status: "completed",
      earnings: 1250,
    },
  ];

  for (const { key, ...shift } of shifts) {
    shiftIds[key] = await ensureShift(
      {
        driver_id: shift.driver_id,
        car_id: shift.car_id,
        start_time: shift.start_time,
        end_time: shift.end_time,
      },
      shift,
    );
  }

  const reservations = [
    {
      user_id: userIds.passengerA,
      shift_id: shiftIds.sharedBooked,
      status: "accepted",
      passenger_count: 2,
      ...ROUTE,
      scheduled_pickup_at: TIMES.sharedPickup,
      fare: null,
    },
    {
      user_id: userIds.passengerB,
      shift_id: shiftIds.sharedBooked,
      status: "accepted",
      passenger_count: 1,
      ...ROUTE,
      scheduled_pickup_at: TIMES.sharedPickup,
      fare: null,
    },
    {
      user_id: userIds.passengerC,
      shift_id: null,
      status: "pending",
      passenger_count: 2,
      ...ROUTE,
      scheduled_pickup_at: TIMES.sharedPickup,
      fare: null,
    },
    {
      user_id: userIds.passengerD,
      shift_id: shiftIds.completed,
      status: "completed",
      passenger_count: 1,
      ...ROUTE,
      scheduled_pickup_at: TIMES.completedPickup,
      fare: 1250,
    },
    {
      user_id: userIds.driverA,
      shift_id: shiftIds.inProgress,
      status: "in_progress",
      passenger_count: 1,
      ...ROUTE,
      scheduled_pickup_at: TIMES.inProgressPickup,
      fare: null,
    },
  ];

  for (const reservation of reservations) {
    await ensureOne(
      "reservations",
      {
        user_id: reservation.user_id,
        scheduled_pickup_at: reservation.scheduled_pickup_at,
        start_latitude: reservation.start_latitude,
        start_longitude: reservation.start_longitude,
        end_latitude: reservation.end_latitude,
        end_longitude: reservation.end_longitude,
      },
      reservation,
    );
  }
}

async function verifySeed() {
  const authUsers = await listAuthUsers();
  const authByEmail = new Map(authUsers.map((user) => [user.email?.toLowerCase(), user]));
  const missingAuth = USERS.filter((fixture) => !authByEmail.has(fixture.email));
  if (missingAuth.length > 0) {
    throw new Error(`Missing Auth users: ${missingAuth.map((user) => user.email).join(", ")}`);
  }

  const userIds = USERS.map((fixture) => authByEmail.get(fixture.email).id);
  const { data: profiles, error: profilesError } = await supabase
    .from("users")
    .select("id, role")
    .in("id", userIds);
  failOnError("Verify public users", profilesError);
  if (profiles.length !== USERS.length) throw new Error("Public user fixture count mismatch");

  const { data: cars, error: carsError } = await supabase
    .from("cars")
    .select("id, car_number, car_capacity")
    .in("car_number", CARS.map((car) => car.car_number));
  failOnError("Verify cars", carsError);
  if (cars.length !== CARS.length) throw new Error("Car fixture count mismatch");

  const { data: sharedReservations, error: sharedError } = await supabase
    .from("reservations")
    .select("passenger_count, shift_id, status")
    .eq("scheduled_pickup_at", TIMES.sharedPickup)
    .eq("start_latitude", ROUTE.start_latitude)
    .eq("start_longitude", ROUTE.start_longitude)
    .eq("end_latitude", ROUTE.end_latitude)
    .eq("end_longitude", ROUTE.end_longitude);
  failOnError("Verify shared ride reservations", sharedError);

  const accepted = sharedReservations.filter((reservation) => reservation.status === "accepted");
  const pending = sharedReservations.filter((reservation) => reservation.status === "pending");
  const acceptedSeats = accepted.reduce((sum, reservation) => sum + reservation.passenger_count, 0);
  const acceptedShiftIds = new Set(accepted.map((reservation) => reservation.shift_id));
  if (accepted.length !== 2 || acceptedSeats !== 3 || acceptedShiftIds.size !== 1) {
    throw new Error("Shared booked Shift fixture is inconsistent");
  }
  if (pending.length !== 1 || pending[0].shift_id !== null) {
    throw new Error("Pending re-matching fixture is inconsistent");
  }

  const { data: statuses, error: statusesError } = await supabase
    .from("shifts")
    .select("status, earnings")
    .in("status", ["available", "booked", "completed", "canceled"]);
  failOnError("Verify Shift statuses", statusesError);
  for (const status of ["available", "booked", "completed", "canceled"]) {
    if (!statuses.some((shift) => shift.status === status)) {
      throw new Error(`Missing Shift status fixture: ${status}`);
    }
  }
  if (!statuses.some((shift) => shift.status === "completed" && Number(shift.earnings) === 1250)) {
    throw new Error("Completed Shift earnings fixture is inconsistent");
  }

  console.log("Seed verification passed.");
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  if (!verifyOnly) {
    const userIds = await ensureAuthUsers();
    await seedPublicData(userIds);
    console.log(`Seeded ${USERS.length} Auth users and matching DB fixtures.`);
  }
  await verifySeed();
  console.log(`Test users: ${USERS.map((user) => user.email).join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
