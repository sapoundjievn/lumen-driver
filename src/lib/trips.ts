/**
 * Lumen shared trip matching + GPS closest-driver cascade
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

export type TripStatus =
  | "searching"
  | "matched"
  | "arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface LumenTrip {
  id: string;
  status: TripStatus;
  pickup: string;
  dropoff: string;
  ride_type: string;
  fare: number;
  tip: number;
  miles: number;
  per_mile: number;
  platform_cut?: number | null;
  driver_payout?: number | null;
  tip_to_driver?: number | null;
  continent?: string | null;
  country?: string | null;
  state_region?: string | null;
  city?: string | null;
  currency?: string | null;
  rider_name: string;
  rider_username: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_username: string | null;
  vehicle: string | null;
  plate: string | null;
  rating: number | null;
  rider_rating: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  offered_driver_id?: string | null;
  offer_expires_at?: string | null;
  declined_driver_ids?: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface DriverPresence {
  driver_id: string;
  name: string;
  username: string;
  vehicle: string;
  plate: string;
  lat: number;
  lng: number;
  online: boolean;
  updated_at?: string;
}

export const OFFER_SECONDS = 25;
export const PLATFORM_SHARE = 0.3;
export const DRIVER_SHARE = 0.7;

/** Driver-facing: 70% of fare + 100% of tip */
export function driverPay(fare: number, tip = 0): number {
  return Math.round((fare * DRIVER_SHARE + Math.max(0, tip)) * 100) / 100;
}

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function tripsConfigured(): boolean {
  return Boolean(url() && key());
}

async function sb(path: string, init: RequestInit = {}) {
  const base = url();
  const anon = key();
  if (!base || !anon) throw new Error("Supabase not configured");
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function createTrip(input: {
  pickup: string;
  dropoff: string;
  ride_type: string;
  fare: number;
  tip: number;
  miles: number;
  per_mile: number;
  rider_name: string;
  rider_username: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
}): Promise<LumenTrip> {
  const base = {
    status: "searching",
    pickup: input.pickup,
    dropoff: input.dropoff,
    ride_type: input.ride_type,
    fare: input.fare,
    tip: input.tip,
    miles: input.miles,
    per_mile: input.per_mile,
    rider_name: input.rider_name,
    rider_username: input.rider_username,
    driver_id: null,
    driver_name: null,
    driver_username: null,
    vehicle: null,
    plate: null,
  };
  try {
    const rows = await sb("lumen_trips", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        pickup_lat: input.pickup_lat ?? null,
        pickup_lng: input.pickup_lng ?? null,
        offered_driver_id: null,
        offer_expires_at: null,
        declined_driver_ids: [],
      }),
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/pickup_lat|offered_driver|declined_driver|column/i.test(msg)) {
      const rows = await sb("lumen_trips", {
        method: "POST",
        body: JSON.stringify(base),
      });
      return Array.isArray(rows) ? rows[0] : rows;
    }
    throw err;
  }
}

export async function getTrip(id: string): Promise<LumenTrip | null> {
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(id)}&select=*`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function listSearchingTrips(): Promise<LumenTrip[]> {
  const rows = await sb(
    "lumen_trips?status=eq.searching&order=created_at.asc&limit=30&select=*"
  );
  return Array.isArray(rows) ? rows : [];
}

export async function listTripsForDriver(driverId: string): Promise<LumenTrip[]> {
  const all = await listSearchingTrips();
  const now = Date.now();
  return all.filter((t) => {
    const declined = t.declined_driver_ids || [];
    if (declined.includes(driverId)) return false;
    if (t.offered_driver_id === driverId) return true;
    if (!t.offered_driver_id) return true;
    if (t.offer_expires_at && new Date(t.offer_expires_at).getTime() < now) {
      return true;
    }
    return false;
  });
}

export async function acceptTrip(
  tripId: string,
  driver: {
    id: string;
    name: string;
    username: string;
    vehicle: string;
    plate: string;
    photo?: string;
    phone?: string;
  }
): Promise<LumenTrip> {
  const extra: Record<string, string> = {};
  if (driver.photo) extra.driver_photo = driver.photo;
  if (driver.phone) extra.driver_phone = driver.phone;
  const rows = await sb(
    `lumen_trips?id=eq.${encodeURIComponent(tripId)}&status=eq.searching`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "matched",
        driver_id: driver.id,
        driver_name: driver.name,
        driver_username: driver.username,
        vehicle: driver.vehicle,
        plate: driver.plate,
        offered_driver_id: driver.id,
        offer_expires_at: null,
        updated_at: new Date().toISOString(),
        ...extra,
      }),
    }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error("Trip already taken by another driver");
  return row;
}

export async function declineTripOffer(
  tripId: string,
  driverId: string
): Promise<LumenTrip | null> {
  const trip = await getTrip(tripId);
  if (!trip || trip.status !== "searching") return trip;
  const declined = Array.from(
    new Set([...(trip.declined_driver_ids || []), driverId])
  );
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}&status=eq.searching`, {
    method: "PATCH",
    body: JSON.stringify({
      declined_driver_ids: declined,
      offered_driver_id: null,
      offer_expires_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function offerTripToDriver(
  tripId: string,
  driverId: string
): Promise<LumenTrip | null> {
  const expires = new Date(Date.now() + OFFER_SECONDS * 1000).toISOString();
  const rows = await sb(
    `lumen_trips?id=eq.${encodeURIComponent(tripId)}&status=eq.searching`,
    {
      method: "PATCH",
      body: JSON.stringify({
        offered_driver_id: driverId,
        offer_expires_at: expires,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function assignClosestDriver(tripId: string): Promise<{
  offered: boolean;
  driverId?: string;
  miles?: number;
  message: string;
}> {
  const trip = await getTrip(tripId);
  if (!trip || trip.status !== "searching") {
    return { offered: false, message: "Trip not searching" };
  }

  const plat = trip.pickup_lat;
  const plng = trip.pickup_lng;
  if (plat == null || plng == null) {
    return { offered: false, message: "No pickup GPS yet" };
  }

  const now = Date.now();
  if (
    trip.offered_driver_id &&
    trip.offer_expires_at &&
    new Date(trip.offer_expires_at).getTime() > now
  ) {
    return {
      offered: true,
      driverId: trip.offered_driver_id,
      message: "Waiting on offered driver",
    };
  }

  let declined = [...(trip.declined_driver_ids || [])];
  if (
    trip.offered_driver_id &&
    trip.offer_expires_at &&
    new Date(trip.offer_expires_at).getTime() <= now
  ) {
    if (!declined.includes(trip.offered_driver_id)) {
      declined.push(trip.offered_driver_id);
    }
    await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        declined_driver_ids: declined,
        offered_driver_id: null,
        offer_expires_at: null,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  const drivers = await listOnlineDrivers();
  const candidates = drivers
    .filter((d) => d.online && !declined.includes(d.driver_id))
    .map((d) => ({
      ...d,
      dist: distanceMiles(plat, plng, d.lat, d.lng),
    }))
    .sort((a, b) => a.dist - b.dist);

  if (candidates.length === 0) {
    return { offered: false, message: "No online drivers nearby" };
  }

  const best = candidates[0];
  await offerTripToDriver(tripId, best.driver_id);
  return {
    offered: true,
    driverId: best.driver_id,
    miles: Math.round(best.dist * 10) / 10,
    message: `Offered to closest driver (~${(Math.round(best.dist * 10) / 10).toFixed(1)} mi)`,
  };
}

export async function upsertDriverPresence(
  p: Omit<DriverPresence, "updated_at">
): Promise<void> {
  await sb("lumen_driver_presence", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      driver_id: p.driver_id,
      name: p.name,
      username: p.username,
      vehicle: p.vehicle,
      plate: p.plate,
      lat: p.lat,
      lng: p.lng,
      online: p.online,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function setDriverOffline(driverId: string): Promise<void> {
  await sb(`lumen_driver_presence?driver_id=eq.${encodeURIComponent(driverId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      online: false,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function listOnlineDrivers(): Promise<DriverPresence[]> {
  const since = new Date(Date.now() - 120_000).toISOString();
  const rows = await sb(
    `lumen_driver_presence?online=eq.true&updated_at=gte.${since}&select=*`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function releaseTrip(tripId: string): Promise<LumenTrip> {
  const trip = await getTrip(tripId);
  const declined = [...(trip?.declined_driver_ids || [])];
  if (trip?.driver_id && !declined.includes(trip.driver_id)) {
    declined.push(trip.driver_id);
  }
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "searching",
      driver_id: null,
      driver_name: null,
      driver_username: null,
      vehicle: null,
      plate: null,
      offered_driver_id: null,
      offer_expires_at: null,
      declined_driver_ids: declined,
      updated_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function updateTripStatus(
  tripId: string,
  status: TripStatus
): Promise<LumenTrip> {
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      updated_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function saveEarlyEndReason(tripId: string, reason: string): Promise<void> {
  try {
    await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        early_end_reason: reason.slice(0, 800),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* column may not exist yet — reason still stored locally */
  }
}

export async function cancelTrip(tripId: string): Promise<LumenTrip | null> {
  if (!tripId || tripId.startsWith("ride_")) return null;
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function cancelSearchingForRider(username: string): Promise<void> {
  const body = JSON.stringify({
    status: "cancelled",
    updated_at: new Date().toISOString(),
  });
  const names = Array.from(
    new Set([
      username,
      username.startsWith("@") ? username.slice(1) : "@" + username,
    ])
  );
  for (const name of names) {
    await sb(
      `lumen_trips?rider_username=eq.${encodeURIComponent(name)}&status=eq.searching`,
      { method: "PATCH", body }
    );
  }
}

export async function rateTrip(
  tripId: string,
  rating: number,
  who: "driver" | "rider" = "driver"
): Promise<LumenTrip> {
  const r = Math.max(1, Math.min(6, Math.round(rating)));
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (who === "driver") body.rating = r;
  else body.rider_rating = r;
  const rows = await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function listRiderTrips(username: string): Promise<LumenTrip[]> {
  const rows = await sb(
    `lumen_trips?rider_username=eq.${encodeURIComponent(username)}&order=created_at.desc&limit=30&select=*`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function listDriverRatings(driverId: string): Promise<{ rating: number }[]> {
  const rows = await sb(
    `lumen_trips?driver_id=eq.${encodeURIComponent(driverId)}&status=eq.completed&order=created_at.desc&limit=250&select=id,rating`
  );
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r: { rating?: number | null }) => Number(r.rating))
    .filter((n) => n >= 1 && n <= 6)
    .map((rating) => ({ rating }));
}

export async function listDriverTrips(driverId: string): Promise<LumenTrip[]> {
  const rows = await sb(
    `lumen_trips?driver_id=eq.${encodeURIComponent(driverId)}&order=created_at.desc&limit=30&select=*`
  );
  return Array.isArray(rows) ? rows : [];
}

export function watchGps(
  onPos: (lat: number, lng: number) => void,
  onErr?: (msg: string) => void
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onErr?.("GPS not available");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onPos(pos.coords.latitude, pos.coords.longitude),
    (err) => onErr?.(err.message || "GPS error"),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

export function getGpsOnce(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  });
}

export function maskPhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 4) return "••••";
  return "(•••) •••-" + d.slice(-4);
}

export async function sendTripMessage(input: {
  trip_id: string;
  sender_role: "driver" | "rider";
  sender_name: string;
  body: string;
}): Promise<void> {
  const text = input.body.trim();
  if (!text) return;
  await sb("lumen_messages", {
    method: "POST",
    body: JSON.stringify({
      trip_id: input.trip_id,
      sender_role: input.sender_role,
      sender_name: input.sender_name,
      body: text.slice(0, 500),
    }),
  });
}

export async function listTripMessages(tripId: string): Promise<
  { id: string; sender_role: string; sender_name: string; body: string; created_at: string }[]
> {
  const rows = await sb(
    `lumen_messages?trip_id=eq.${encodeURIComponent(tripId)}&order=created_at.asc&limit=80`
  );
  return Array.isArray(rows) ? rows : [];
}

export async function patchTripSafety(
  tripId: string,
  fields: Record<string, string | null>
): Promise<void> {
  try {
    await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
      method: "PATCH",
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
    });
  } catch {
    /* extra columns may not exist yet */
  }
}

export async function uploadDriverPhoto(driverId: string, blob: Blob): Promise<string> {
  const base = url().replace(/\/$/, "");
  const k = key();
  const path = encodeURIComponent(driverId) + ".jpg";
  const headers = {
    Authorization: "Bearer " + k,
    apikey: k,
    "Content-Type": "image/jpeg",
    "x-upsert": "true",
  };
  let res = await fetch(base + "/storage/v1/object/driver-photos/" + path, {
    method: "POST",
    headers,
    body: blob,
  });
  if (!res.ok) {
    res = await fetch(base + "/storage/v1/object/driver-photos/" + path, {
      method: "PUT",
      headers,
      body: blob,
    });
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Photo upload failed");
  }
  return base + "/storage/v1/object/public/driver-photos/" + path + "?t=" + Date.now();
}

export async function startPlatformCall(tripId: string, fromRole: "driver" | "rider"): Promise<void> {
  await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      call_status: "ringing",
      call_from: fromRole,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function answerPlatformCall(tripId: string): Promise<void> {
  await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      call_status: "active",
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function endPlatformCall(tripId: string): Promise<void> {
  await sb(`lumen_trips?id=eq.${encodeURIComponent(tripId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      call_status: "ended",
      call_from: null,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function saveDriverAccount(profile: Record<string, unknown>): Promise<void> {
  const id = String(profile.id || "");
  const email = String(profile.email || "").toLowerCase();
  if (!id || !email) return;
  const body = {
    id,
    email,
    username: String(profile.username || ""),
    password: String(profile.password || ""),
    profile,
    updated_at: new Date().toISOString(),
  };
  try {
    await sb("lumen_driver_accounts?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
  } catch {
    try {
      await sb("lumen_driver_accounts?email=eq." + encodeURIComponent(email), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } catch {}
  }
}

export async function loadDriverAccount(
  emailOrUser: string,
  password: string
): Promise<Record<string, unknown> | null> {
  const raw = emailOrUser.trim().toLowerCase();
  if (!raw || !password) return null;
  const q =
    raw.includes("@") && !raw.startsWith("@")
      ? `lumen_driver_accounts?email=eq.${encodeURIComponent(raw)}&password=eq.${encodeURIComponent(password)}&limit=1`
      : `lumen_driver_accounts?or=(username.eq.${encodeURIComponent(raw)},username.eq.${encodeURIComponent("@" + raw)})&password=eq.${encodeURIComponent(password)}&limit=1`;
  const rows = await sb(q);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return (row.profile as Record<string, unknown>) || row;
}

export const SUPPORT_EMAIL = "sapoundjievn@icloud.com";

export const SUPPORT_CATEGORIES = [
  { id: "trip", title: "Trip support", detail: "Help with an active or past trip" },
  { id: "lost", title: "Lost & found", detail: "Something left in a vehicle" },
  { id: "safety", title: "Safety", detail: "Report a safety concern" },
  { id: "payments", title: "Payments", detail: "Fares, tips, refunds" },
];

export async function sendSupportTicket(input: {
  role: "driver" | "rider";
  name: string;
  email: string;
  phone: string;
  category: string;
  message: string;
}): Promise<void> {
  const row = {
    role: input.role,
    name: input.name.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    category: input.category,
    message: input.message.trim(),
    created_at: new Date().toISOString(),
  };
  try {
    await sb("lumen_support", { method: "POST", body: JSON.stringify(row) });
  } catch {}
  try {
    await fetch("https://formsubmit.co/ajax/" + SUPPORT_EMAIL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: "[Lumen " + input.category + "] " + input.name,
        ...row,
      }),
    });
  } catch {}
}
