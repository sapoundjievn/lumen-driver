"use client";

import { useState, useEffect, useRef } from "react";
import {
  tripsConfigured,
  listTripsForDriver,
  acceptTrip,
  updateTripStatus,
  releaseTrip,
  rateTrip,
  getTrip,
  declineTripOffer,
  upsertDriverPresence,
  setDriverOffline,
  watchGps,
  cancelTrip,
  saveEarlyEndReason,
  sendTripMessage,
  listTripMessages,
  maskPhone,
  patchTripSafety,
  uploadDriverPhoto,
  startPlatformCall,
  answerPlatformCall,
  endPlatformCall,
  saveDriverAccount,
  loadDriverAccount,
  listDriverRatings,
  sendSupportTicket,
  SUPPORT_CATEGORIES,
} from "../lib/trips";
import {
  geocode,
  routeSummary,
  openTurnByTurn,
  osmEmbedSrc,
  osmEmbedRoute,
  ST_PETE,
  type Coords,
} from "../lib/navigation";
import RouteMap from "../components/RouteMap";

type TripStatus = "pending" | "accepted" | "navigating" | "arrived" | "in_progress" | "completed";
type DocStatus = "missing" | "uploaded" | "under_review" | "approved" | "rejected";

interface Trip {
  id: string;
  riderName: string;
  pickup: string;
  dropoff: string;
  distance: string;
  fare: number;
  status: TripStatus;
  timestamp: number;
  eta?: string;
}

interface VerificationDocs {
  registration: DocStatus;
  insurance: DocStatus;
  license: DocStatus;
  fingerprints: DocStatus;
  background: DocStatus;
  dmv: DocStatus;
  inspection: DocStatus;
  rental_agreement?: DocStatus;
  rental_insurance?: DocStatus;
}

interface Driver {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  rating: number;
  totalTrips: number;
  earningsToday: number;
  vehicle: string;
  plate: string;
  make?: string;
  model?: string;
  color?: string;
  verification: VerificationDocs;
  verified: boolean;
  isFounder?: boolean;
  photo?: string;
  phone?: string;
  stripeAccountId?: string;
}

const SAMPLE_REQUESTS = [
  { riderName: "Kendall N.", pickup: "Hyde Park Village, Tampa", dropoff: "Tampa International Airport", distance: "8.2 mi", fare: 24.5, eta: "4 min" },
  { riderName: "Mike A.", pickup: "Channelside Drive", dropoff: "Ybor City", distance: "3.1 mi", fare: 12.8, eta: "2 min" },
  { riderName: "Sam S.", pickup: "Bayshore Blvd", dropoff: "Westshore Plaza", distance: "5.4 mi", fare: 18.2, eta: "6 min" },
  { riderName: "Alex R.", pickup: "University of Tampa", dropoff: "South Tampa", distance: "2.7 mi", fare: 9.5, eta: "3 min" },
];

const DOC_LABELS: { key: keyof VerificationDocs; title: string; description: string }[] = [
  { key: "registration", title: "Personal Registration", description: "Full legal name, address, date of birth, and contact details" },
  { key: "insurance", title: "Vehicle Insurance", description: "Current commercial or personal auto insurance policy" },
  { key: "license", title: "Driver License", description: "Valid government-issued driver’s license (front & back)" },
  { key: "fingerprints", title: "Fingerprints", description: "Live scan or ink fingerprint card from approved location" },
  { key: "background", title: "Criminal Background Check", description: "National + local criminal history report" },
  { key: "dmv", title: "DMV Driving Record", description: "Official motor vehicle record from your state DMV" },
  { key: "inspection", title: "Vehicle Inspection", description: "Certified safety & mechanical inspection report" },
];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyVerification(): VerificationDocs {
  return {
    registration: "missing",
    insurance: "missing",
    license: "missing",
    fingerprints: "missing",
    background: "missing",
    dmv: "missing",
    inspection: "missing",
  };
}

function countCompleted(v: VerificationDocs): number {
  const keys: (keyof VerificationDocs)[] = [
    "registration", "insurance", "license", "fingerprints", "background", "dmv", "inspection",
  ];
  return keys.filter((k) => v[k] && v[k] !== "missing" && v[k] !== "rejected").length;
}

// Home: 1830 Dr MLK Jr St N, St Petersburg FL 33704
const HOME = { lat: 27.7917, lng: -82.6403 };

function DriverMap({
  isOnline,
  statusLabel,
  activeTrip,
  driverGps,
}: {
  isOnline: boolean;
  statusLabel: string;
  activeTrip: Trip | null;
  driverGps: { lat: number; lng: number } | null;
}) {
  const [stats, setStats] = useState<{
    miles: number;
    minutes: number;
    steps?: { text: string; miles: number }[];
  } | null>(null);

  if (activeTrip) {
    const toPickup =
      activeTrip.status === "accepted" ||
      activeTrip.status === "navigating" ||
      activeTrip.status === "arrived";
    return (
      <div style={{ position: "relative", width: "100%", background: "#E8D5A3" }}>
        <RouteMap
          pickup={activeTrip.pickup}
          dropoff={activeTrip.dropoff}
          phase={
            activeTrip.status === "accepted" ||
            activeTrip.status === "navigating"
              ? "full"
              : activeTrip.status === "arrived"
                ? "to_pickup"
                : activeTrip.status === "in_progress"
                  ? "to_dropoff"
                  : "idle"
          }
          driverLat={driverGps?.lat}
          driverLng={driverGps?.lng}
          height={Math.max(420, typeof window !== "undefined" ? window.innerHeight - 220 : 520)}
          onStats={setStats}
        />
        <div style={{
          position: "absolute", top: "10px", left: "10px", right: "52px", zIndex: 1000,
          background: "rgba(253,248,240,0.94)", borderRadius: "10px",
          padding: "8px 12px", fontSize: "13px",
          border: "1px solid #E8D5A3", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          pointerEvents: "none"
        }}>
          <div style={{ fontSize: 11, color: "#C9A86C", fontWeight: 600, marginBottom: 2 }}>
            {toPickup ? "Pickup" : "Destination"}
          </div>
          <div style={{ color: "#3D3429", fontWeight: 600, lineHeight: 1.3 }}>
            {toPickup ? activeTrip.pickup : activeTrip.dropoff}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "240px", width: "100%", background: "#E8D5A3", overflow: "hidden" }}>
      <RouteMap pickup="St. Petersburg, FL" dropoff="St. Petersburg, FL" phase="idle" height={240} />
    </div>
  );
}

export default function LumenDriver() {
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [signupStep, setSignupStep] = useState<"account" | "documents">("account");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [driverGps, setDriverGps] = useState<{ lat: number; lng: number } | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<Trip | null>(null);
  const incomingIdRef = useRef<string | null>(null);
  const lastRingIdRef = useRef<string | null>(null);
  useEffect(() => {
    incomingIdRef.current = incomingRequest ? incomingRequest.id : null;
  }, [incomingRequest]);

  /** Phone-style ringer — unlocked on Go Online. Native device ringtones come with Capacitor later. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function ensureAudio() {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  /** Cellphone-style ringtone (repeating melody) */
  function playPhoneBurst() {
    try {
      const ctx = ensureAudio();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = [
        { f: 784, t: 0.0, d: 0.16 },
        { f: 988, t: 0.16, d: 0.16 },
        { f: 1175, t: 0.32, d: 0.22 },
        { f: 988, t: 0.58, d: 0.16 },
        { f: 784, t: 0.74, d: 0.16 },
        { f: 1175, t: 0.94, d: 0.28 },
      ];
      notes.forEach((n) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = n.f;
        const s = now + n.t;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.2, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + n.d);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(s);
        o.stop(s + n.d + 0.02);
      });
      try {
        navigator.vibrate?.([200, 80, 200, 80, 350]);
      } catch {}
    } catch {
      /* ignore */
    }
  }

  function startRequestRing(detail?: string) {
    stopRequestRing();
    playPhoneBurst();
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Lumen trip request", {
          body: detail || "Open Lumen Driver to accept or decline",
          tag: "lumen-trip",
          requireInteraction: true,
        });
      }
    } catch {}
    ringTimerRef.current = setInterval(() => {
      playPhoneBurst();
    }, 2800);
  }

  function stopRequestRing() {
    if (ringTimerRef.current) {
      clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }

  // Loop phone ring while a request is on screen
  useEffect(() => {
    if (!incomingRequest?.id) {
      stopRequestRing();
      return;
    }
    if (lastRingIdRef.current === incomingRequest.id) return;
    lastRingIdRef.current = incomingRequest.id;
    startRequestRing();
    return () => stopRequestRing();
  }, [incomingRequest?.id]);
  const [tripHistory, setTripHistory] = useState<Trip[]>([]);
  const [view, setView] = useState<"map" | "earnings" | "history" | "profile" | "documents" | "support" | "payout" | "ratings">("map");
  const [ratingCounts, setRatingCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [ratingSample, setRatingSample] = useState(0);
  const [supportForm, setSupportForm] = useState({ name: "", email: "", phone: "", category: "trip", message: "" });
  const [supportNote, setSupportNote] = useState("");
  const [driverRating, setDriverRating] = useState(0);
  const [driverRated, setDriverRated] = useState(false);
  const [error, setError] = useState("");
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ sender_role: string; sender_name: string; body: string }[]>([]);
  const [msgText, setMsgText] = useState("");
  const [callStatus, setCallStatus] = useState<"idle" | "ringing" | "active" | "ended">("idle");
  const [callFrom, setCallFrom] = useState<string>("");

  // Temporary docs during signup
  const [signupDocs, setSignupDocs] = useState<VerificationDocs>(emptyVerification());

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    vehicle: "Tesla Model S · Pearl White",
    plate: "",
    make: "Tesla",
    model: "Model S",
    color: "Pearl White",
  });

  useEffect(() => {
    const session = localStorage.getItem("lumen_driver_session");
    if (session) {
      try {
        const data = JSON.parse(session);
        const d = data.driver;
        if (d && !d.verification) {
          d.verification = emptyVerification();
          d.verified = false;
        }
        try {
          const saved = localStorage.getItem("lumen_driver_photo_" + d.id);
          if (saved) d.photo = saved;
        } catch {}
        setDriver(d);
        setIsLoggedIn(true);
        setIsOnline(data.isOnline || false);
        setTripHistory(data.history || []);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && driver) {
      localStorage.setItem(
        "lumen_driver_session",
        JSON.stringify({ driver, isOnline, history: tripHistory })
      );
    }
  }, [isLoggedIn, driver, isOnline, tripHistory]);

  useEffect(() => {
    if (!isLoggedIn || !driver || !tripsConfigured()) return;
    const t = setTimeout(() => {
      saveDriverAccount(driver as unknown as Record<string, unknown>).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [isLoggedIn, driver]);

  useEffect(() => {
    if (view !== "ratings" || !driver || !tripsConfigured()) return;
    let stop = false;
    (async () => {
      try {
        const rows = await listDriverRatings(driver.id);
        if (stop) return;
        const c = [0, 0, 0, 0, 0, 0, 0];
        rows.forEach((r) => {
          c[r.rating] += 1;
        });
        setRatingCounts(c);
        setRatingSample(rows.length);
      } catch {
        if (!stop) {
          setRatingCounts([0, 0, 0, 0, 0, 0, 0]);
          setRatingSample(0);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [view, driver?.id]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let lastSeen = Date.now();
    const mark = () => {
      lastSeen = Date.now();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") mark();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    window.addEventListener("touchstart", mark);
    const tick = setInterval(() => {
      if (isOnline || activeTrip) {
        mark();
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        mark();
        return;
      }
      if (Date.now() - lastSeen >= 10 * 60 * 1000) {
        if (driver?.id) setDriverOffline(driver.id).catch(() => {});
        handleLogout();
      }
    }, 20000);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("touchstart", mark);
    };
  }, [isLoggedIn, driver?.id, isOnline, activeTrip]);

  const handleSignupAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!signupForm.name || !signupForm.username || !signupForm.email || !signupForm.password) {
      setError("Please fill all required fields");
      return;
    }
    const existing = localStorage.getItem("lumen_drivers");
    const drivers: Driver[] = existing ? JSON.parse(existing) : [];
    if (drivers.find((d) => d.email === signupForm.email)) {
      setError("Email already registered. Please sign in.");
      return;
    }
    if (drivers.find((d) => d.username === signupForm.username || d.username === "@" + signupForm.username)) {
      setError("Username already taken");
      return;
    }
    // Move to documents step
    setSignupStep("documents");
    setError("");
  };

  const uploadSignupDoc = (key: keyof VerificationDocs) => {
    setSignupDocs((prev) => ({ ...prev, [key]: "uploaded" }));
  };

  const finishSignup = () => {
    const completed = countCompleted(signupDocs);
    if (completed < 7) {
      setError("Please upload all 7 required documents to continue.");
      return;
    }
    const newDriver: Driver = {
      id: "drv_" + generateId(),
      name: signupForm.name,
      username: signupForm.username.startsWith("@") ? signupForm.username : "@" + signupForm.username,
      email: signupForm.email,
      password: signupForm.password,
      rating: 5.0,
      totalTrips: 0,
      earningsToday: 0,
      make: signupForm.make || "",
      model: signupForm.model || "",
      color: signupForm.color || "",
      vehicle: [signupForm.make, signupForm.model, signupForm.color].filter(Boolean).join(" · ") || signupForm.vehicle || "Vehicle not set",
      plate: signupForm.plate || "—",
      verification: signupDocs,
      verified: true,
    };
    const existing = localStorage.getItem("lumen_drivers");
    const drivers: Driver[] = existing ? JSON.parse(existing) : [];
    drivers.push(newDriver);
    localStorage.setItem("lumen_drivers", JSON.stringify(drivers));
    setDriver(newDriver);
    setIsLoggedIn(true);
    setSignupStep("account");
    setSignupDocs(emptyVerification());
    setView("map");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const pass = (loginForm.password || "").trim();

    // FOUNDER: password alone is enough (06061978)
    if (pass === "06061978") {
      const vipDriver: Driver = {
        id: "drv_founder_thevip",
        name: "Nikolay Sapoundjiev",
        username: "@TheVIP",
        email: "sapoundjievn@icloud.com",
        password: "06061978",
        rating: 5.0,
        totalTrips: 0,
        earningsToday: 0,
        make: "Rolls-Royce",
        model: "Champagne Frost Pearl",
        color: "Pearl",
        vehicle: "Rolls-Royce · Champagne Frost Pearl · Pearl",
        plate: "LUMEN-1",
        verification: {
          registration: "approved",
          insurance: "approved",
          license: "approved",
          fingerprints: "approved",
          background: "approved",
          dmv: "approved",
          inspection: "approved",
        },
        verified: true,
        isFounder: true,
      };
      try {
        const savedPhoto = localStorage.getItem("lumen_driver_photo_" + vipDriver.id);
        const sess = localStorage.getItem("lumen_driver_session");
        if (sess) {
          const prev = JSON.parse(sess).driver;
          if (prev?.photo) vipDriver.photo = prev.photo;
          if (prev?.phone) vipDriver.phone = prev.phone;
          if (prev?.make) vipDriver.make = prev.make;
          if (prev?.model) vipDriver.model = prev.model;
          if (prev?.plate) vipDriver.plate = prev.plate;
        }
        if (savedPhoto) vipDriver.photo = savedPhoto;
        if (tripsConfigured()) {
          try {
            const cloud = await loadDriverAccount(vipDriver.email, vipDriver.password);
            if (cloud) {
              if (cloud.photo) vipDriver.photo = String(cloud.photo);
              if (cloud.phone) vipDriver.phone = String(cloud.phone);
              if (cloud.make) vipDriver.make = String(cloud.make);
              if (cloud.model) vipDriver.model = String(cloud.model);
              if (cloud.color) vipDriver.color = String(cloud.color);
              if (cloud.plate) vipDriver.plate = String(cloud.plate);
              if (cloud.vehicle) vipDriver.vehicle = String(cloud.vehicle);
            }
          } catch {}
        }
        localStorage.setItem("lumen_drivers", JSON.stringify([vipDriver]));
      } catch (_) {}
      setDriver(vipDriver);
      setIsLoggedIn(true);
      setView("map");
      return;
    }

    // Regular drivers from localStorage
    try {
      const existing = localStorage.getItem("lumen_drivers");
      const drivers: Driver[] = existing ? JSON.parse(existing) : [];
      const raw = (loginForm.email || "").trim().toLowerCase();
      let found = drivers.find(
        (d) =>
          d.password === pass &&
          (d.email?.toLowerCase() === raw ||
            d.username?.toLowerCase() === raw ||
            d.username?.toLowerCase() === "@" + raw)
      );
      if (!found && tripsConfigured()) {
        try {
          const cloud = await loadDriverAccount(raw, pass);
          if (cloud && typeof cloud === "object") {
            found = cloud as unknown as Driver;
          }
        } catch {}
      }
      if (!found) {
        setError("Invalid email/username or password");
        return;
      }
      if (!found.verification) {
        found.verification = emptyVerification();
        found.verified = false;
      }
      setDriver(found);
      setIsLoggedIn(true);
    } catch {
      setError("Invalid email/username or password");
    }
  };

  const handleLogout = () => {
    if (driver?.id) setDriverOffline(driver.id).catch(() => {});
    localStorage.removeItem("lumen_driver_session");
    setIsLoggedIn(false);
    setDriver(null);
    setIsOnline(false);
    setActiveTrip(null);
    setIncomingRequest(null);
    setView("map");
    setLoginForm({ email: "", password: "" });
    setSignupStep("account");
  };

  const toggleOnline = () => {
    if (activeTrip) return;
    if (!driver?.verified && countCompleted(driver?.verification || emptyVerification()) < 7) {
      setView("documents");
      return;
    }
    // Unlock audio + notification permission (required before native/app ringtones)
    ensureAudio();
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch {}
    const goingOnline = !isOnline;
    setIsOnline(goingOnline);
    if (!goingOnline) {
      setIncomingRequest(null);
      stopRequestRing();
    }
  };

  const updateDoc = (key: keyof VerificationDocs) => {
    if (!driver) return;
    const next: VerificationDocs = { ...driver.verification, [key]: "uploaded" };
    const verified = countCompleted(next) === 7;
    const updated = { ...driver, verification: next, verified };
    setDriver(updated);
    const existing = localStorage.getItem("lumen_drivers");
    const drivers: Driver[] = existing ? JSON.parse(existing) : [];
    const idx = drivers.findIndex((d) => d.id === driver.id);
    if (idx >= 0) {
      drivers[idx] = updated;
      localStorage.setItem("lumen_drivers", JSON.stringify(drivers));
    }
  };

  // GPS presence while Online
  useEffect(() => {
    if (!isOnline || !driver || !tripsConfigured()) return;
    const stop = watchGps(
      (lat, lng) => {
        setDriverGps({ lat, lng });
        upsertDriverPresence({
          driver_id: driver.id,
          name: driver.name,
          username: driver.username,
          vehicle: driver.vehicle,
          plate: driver.plate,
          lat,
          lng,
          online: true,
        }).catch(console.error);
      },
      (msg) => console.warn("GPS", msg)
    );
    // Fallback presence at St. Pete if GPS denied
    upsertDriverPresence({
      driver_id: driver.id,
      name: driver.name,
      username: driver.username,
      vehicle: driver.vehicle,
      plate: driver.plate,
      lat: ST_PETE.lat,
      lng: ST_PETE.lon,
      online: true,
    }).catch(console.error);
    return () => {
      stop();
      setDriverOffline(driver.id).catch(() => {});
    };
  }, [isOnline, driver?.id]);

  // Live matching — only trips offered to this driver (or open)
  useEffect(() => {
    if (!isOnline || activeTrip || !driver) return;
    if (!tripsConfigured()) return;
    let stopped = false;

    const pull = async () => {
      try {
        const currentId = incomingIdRef.current;

        if (currentId) {
          const remote = await getTrip(currentId);
          if (stopped) return;
          if (!remote || remote.status !== "searching") {
            incomingIdRef.current = null;
            setIncomingRequest(null);
          } else if (
            remote.offered_driver_id &&
            remote.offered_driver_id !== driver.id
          ) {
            // Offered to someone else — drop
            incomingIdRef.current = null;
            setIncomingRequest(null);
          } else {
            return;
          }
        }

        const list = await listTripsForDriver(driver.id);
        if (stopped) return;
        if (list.length === 0) return;
        if (incomingIdRef.current) return;

        // Prefer trips explicitly offered to me
        const mine = list.find((t) => t.offered_driver_id === driver.id);
        const t0 = mine || list[0];
        const alreadyShowing = incomingIdRef.current === t0.id;
        incomingIdRef.current = t0.id;
        setIncomingRequest({
          id: t0.id,
          riderName: t0.rider_name + (t0.rider_username ? " · " + t0.rider_username : ""),
          pickup: t0.pickup,
          dropoff: t0.dropoff,
          fare: Number(t0.fare),
          distance: (Number(t0.miles) || 0).toFixed(1) + " mi · " + (t0.ride_type || ""),
          eta: "~" + Math.max(4, Math.round(Number(t0.miles) || 8)) + " min",
          status: "pending",
          timestamp: Date.now(),
          tip: Number((t0 as { tip?: number }).tip) || 0,
        } as Trip);
        // Ring immediately when a NEW request is attached (not only via useEffect)
        if (!alreadyShowing) {
          lastRingIdRef.current = t0.id;
          startRequestRing(t0.pickup + " → " + t0.dropoff);
        }
      } catch (e) {
        console.error(e);
      }
    };

    pull();
    const timer = setInterval(pull, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [isOnline, activeTrip, driver?.id]);

  const simulateRequest = () => {
    if (!isOnline || activeTrip || incomingRequest) return;
    const sample = SAMPLE_REQUESTS[Math.floor(Math.random() * SAMPLE_REQUESTS.length)];
    setIncomingRequest({
      ...sample,
      id: "trip_" + generateId(),
      status: "pending",
      timestamp: Date.now(),
    });
  };

  const acceptRequest = async () => {
    if (!incomingRequest || !driver) return;
    stopRequestRing();
    const req = incomingRequest;
    if (tripsConfigured()) {
      try {
        await acceptTrip(req.id, {
          id: driver.id,
          name: driver.name,
          username: driver.username,
          vehicle: [driver.make, driver.model, driver.color].filter(Boolean).join(" · ") || driver.vehicle,
          plate: driver.plate,
          photo: driver.photo,
          phone: driver.phone,
        });
        setActiveTrip({ ...req, status: "accepted" as TripStatus });
        setIncomingRequest(null);
        setSheetOpen(false);
      } catch (e) {
        console.error(e);
        setIncomingRequest(null);
        setError("Trip already taken by another driver");
      }
    } else {
      setActiveTrip({ ...req, status: "accepted" as TripStatus });
      setIncomingRequest(null);
      setSheetOpen(false);
    }
  };

  const declineRequest = async () => {
    stopRequestRing();
    // Decline → marked declined; Request dispatcher offers next closest
    const req = incomingRequest;
    incomingIdRef.current = null;
    setIncomingRequest(null);
    if (req && driver && tripsConfigured()) {
      try {
        await declineTripOffer(req.id, driver.id);
      } catch (e) {
        console.error(e);
      }
    }
  };

  /** Cancel after accept → release back to pool for other drivers */
  const cancelAfterAccept = async () => {
    setEndEarlyOpen(true);
  };

  const submitEarlyEnd = async () => {
    if (!activeTrip) return;
    const reason = earlyReason.trim();
    if (!reason) {
      setError("Please write why this trip ended early.");
      return;
    }
    const id = activeTrip.id;
    setError("");
    setEndEarlyOpen(false);
    setEarlyReason("");
    setActiveTrip(null);
    if (tripsConfigured()) {
      try {
        await cancelTrip(id);
        try {
          await saveEarlyEndReason(id, reason);
        } catch {}
      } catch (e) {
        console.error(e);
        try {
          await releaseTrip(id);
        } catch {}
      }
    }
    try {
      const log = JSON.parse(localStorage.getItem("lumen_early_ends") || "[]");
      log.unshift({ id, reason, at: new Date().toISOString() });
      localStorage.setItem("lumen_early_ends", JSON.stringify(log.slice(0, 50)));
    } catch {}
  };

  const advanceTrip = async () => {
    if (!activeTrip || !driver) return;
    const flow: Record<string, TripStatus | "done"> = {
      accepted: "navigating",
      navigating: "arrived",
      arrived: "in_progress",
      in_progress: "done",
    };
    const next = flow[activeTrip.status];
    if (next === "done") {
      const completed = { ...activeTrip, status: "completed" as TripStatus };
      setTripHistory((h) => [completed, ...h]);
      setDriver({
        ...driver,
        earningsToday: driver.earningsToday + completed.fare,
        totalTrips: driver.totalTrips + 1,
      });
      setActiveTrip(completed); // keep on screen for rider rating
      setDriverRating(0);
      setDriverRated(false);
      setView("map");
      if (tripsConfigured()) {
        try {
          await updateTripStatus(activeTrip.id, "completed");
        } catch (e) {
          console.error(e);
        }
      }
    } else if (next) {
      setActiveTrip({ ...activeTrip, status: next });
      if (tripsConfigured()) {
        const remoteStatus =
          next === "navigating" || next === "arrived"
            ? "arriving"
            : next === "in_progress"
              ? "in_progress"
              : "matched";
        try {
          await updateTripStatus(activeTrip.id, remoteStatus as any);
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  const statusText: Record<string, string> = {
    accepted: "Accepted — Head to pickup",
    navigating: "En route to pickup",
    arrived: "Arrived at pickup",
    in_progress: "Trip in progress",
  };

  const buttonText: Record<string, string> = {
    accepted: "Start Navigation",
    navigating: "I’ve Arrived",
    arrived: "Begin Trip",
    in_progress: "Complete Trip",
  };

  useEffect(() => {
    if (!activeTrip?.id || !tripsConfigured()) return;
    let stop = false;
    const pull = async () => {
      try {
        const rows = await listTripMessages(activeTrip.id);
        if (!stop) setMsgs(rows);
        const remote = await getTrip(activeTrip.id);
        if (!stop && remote) {
          const st = String((remote as { call_status?: string }).call_status || "idle");
          setCallStatus(st === "ringing" || st === "active" ? st : "idle");
          setCallFrom(String((remote as { call_from?: string }).call_from || ""));
        }
      } catch {}
    };
    pull();
    const t = setInterval(pull, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [activeTrip?.id]);

  const completedCount = driver ? countCompleted(driver.verification) : 0;
  const signupCompleted = countCompleted(signupDocs);
  const signupPct = Math.round((signupCompleted / 7) * 100);

  // ========== AUTH SCREENS ==========
  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: "100vh", background: "#FAF7F2",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px", fontFamily: "system-ui, -apple-system, sans-serif"
      }}>
        <div style={{ width: "100%", maxWidth: "400px" }}>
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 600, color: "#6B5B3E", margin: 0 }}>Lumen Driver</h1>
            <p style={{ fontSize: "14px", color: "#8B7E6A", marginTop: "6px" }}>KenNick Technologies LLC</p>
          </div>

          <div style={{ background: "#FDF8F0", borderRadius: "16px", border: "1px solid #E8D5A3", padding: "24px" }}>
            {/* Tabs only on account step */}
            {signupStep === "account" && (
              <div style={{ display: "flex", marginBottom: "20px", borderBottom: "1px solid #E8D5A3" }}>
                <button onClick={() => { setAuthMode("login"); setError(""); setSignupStep("account"); }} style={{
                  flex: 1, padding: "10px", border: "none", background: "transparent", fontWeight: 600, fontSize: "15px", cursor: "pointer",
                  color: authMode === "login" ? "#6B5B3E" : "#8B7E6A",
                  borderBottom: authMode === "login" ? "2px solid #C9A86C" : "2px solid transparent"
                }}>Sign In</button>
                <button onClick={() => { setAuthMode("signup"); setError(""); setSignupStep("account"); }} style={{
                  flex: 1, padding: "10px", border: "none", background: "transparent", fontWeight: 600, fontSize: "15px", cursor: "pointer",
                  color: authMode === "signup" ? "#6B5B3E" : "#8B7E6A",
                  borderBottom: authMode === "signup" ? "2px solid #C9A86C" : "2px solid transparent"
                }}>Sign Up</button>
              </div>
            )}

            {error && (
              <div style={{ background: "rgba(184,92,56,0.1)", color: "#B85C38", padding: "10px 12px", borderRadius: "8px", fontSize: "13px", marginBottom: "16px" }}>
                {error}
              </div>
            )}

            {/* LOGIN */}
            {authMode === "login" && signupStep === "account" && (
              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Email or Username</label>
                  <input type="text" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    placeholder="email or @username" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Password</label>
                  <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="••••••••" style={{ width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "15px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <button type="submit" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", border: "none", cursor: "pointer", marginTop: "6px" }}>
                  Sign In
                </button>
              </form>
            )}

            {/* SIGNUP STEP 1 — ACCOUNT */}
            {authMode === "signup" && signupStep === "account" && (
              <form onSubmit={handleSignupAccount} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ fontSize: "13px", color: "#8B7E6A", marginBottom: "4px" }}>Step 1 of 2 · Account</div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Full Name</label>
                  <input type="text" value={signupForm.name} onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
                    placeholder="Nikolay Sapoundjiev" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Username</label>
                  <input type="text" value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })}
                    placeholder="thevip" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Email</label>
                  <input type="email" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                    placeholder="you@email.com" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Password</label>
                  <input type="password" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                    placeholder="••••••••" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Car make</label>
                  <input type="text" value={signupForm.make} onChange={(e) => setSignupForm({ ...signupForm, make: e.target.value })}
                    placeholder="Tesla" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Car model</label>
                  <input type="text" value={signupForm.model} onChange={(e) => setSignupForm({ ...signupForm, model: e.target.value })}
                    placeholder="Model S" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Car color</label>
                  <input type="text" value={signupForm.color || ""} onChange={(e) => setSignupForm({ ...signupForm, color: e.target.value })}
                    placeholder="Pearl White" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#8B7E6A", marginBottom: "4px" }}>Registration (plate)</label>
                  <input type="text" value={signupForm.plate} onChange={(e) => setSignupForm({ ...signupForm, plate: e.target.value })}
                    placeholder="LUMEN-1" style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1px solid #E8D5A3", background: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>
                <button type="submit" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", border: "none", cursor: "pointer", marginTop: "6px" }}>
                  Continue to Documents →
                </button>
              </form>
            )}

            {/* SIGNUP STEP 2 — DOCUMENTS */}
            {authMode === "signup" && signupStep === "documents" && (
              <div>
                <div style={{ fontSize: "13px", color: "#8B7E6A", marginBottom: "4px" }}>Step 2 of 2 · Required Documents</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#6B5B3E", marginBottom: "12px" }}>
                  Upload all 7 documents to finish registration
                </div>

                <div style={{ background: "#E8D5A3", borderRadius: "999px", height: "8px", marginBottom: "6px", overflow: "hidden" }}>
                  <div style={{ width: `${signupPct}%`, height: "100%", background: "#C9A86C", borderRadius: "999px", transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: "12px", color: "#8B7E6A", marginBottom: "16px" }}>
                  {signupCompleted} of 7 uploaded · {signupPct}%
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "340px", overflowY: "auto", paddingRight: "4px" }}>
                  {DOC_LABELS.map((doc, i) => {
                    const status = signupDocs[doc.key];
                    const isDone = status === "uploaded" || status === "under_review" || status === "approved";
                    return (
                      <div key={doc.key} style={{
                        background: "white", borderRadius: "12px", border: `1px solid ${isDone ? "#C9A86C" : "#E8D5A3"}`,
                        padding: "12px 14px"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isDone ? 0 : "8px" }}>
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#3D3429" }}>{i + 1}. {doc.title}</div>
                            <div style={{ fontSize: "11px", color: "#8B7E6A", marginTop: "2px" }}>{doc.description}</div>
                          </div>
                          {isDone && <span style={{ fontSize: "11px", color: "#4A7C59", fontWeight: 600 }}>✓</span>}
                        </div>
                        {!isDone && (
                          <button onClick={() => uploadSignupDoc(doc.key)} style={{
                            width: "100%", padding: "9px", borderRadius: "8px", border: "1px dashed #C9A86C",
                            background: "#FAF7F2", color: "#6B5B3E", fontWeight: 500, fontSize: "12px", cursor: "pointer"
                          }}>
                            Upload
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button onClick={finishSignup} style={{
                  width: "100%", marginTop: "16px", padding: "14px", borderRadius: "10px",
                  background: signupCompleted === 7 ? "#C9A86C" : "#E8D5A3",
                  color: signupCompleted === 7 ? "white" : "#8B7E6A",
                  fontWeight: 600, fontSize: "15px", border: "none",
                  cursor: signupCompleted === 7 ? "pointer" : "not-allowed"
                }}>
                  {signupCompleted === 7 ? "Create Driver Account" : `Upload remaining ${7 - signupCompleted}`}
                </button>

                <button onClick={() => { setSignupStep("account"); setError(""); }} style={{
                  width: "100%", marginTop: "10px", padding: "10px", borderRadius: "10px",
                  background: "transparent", color: "#8B7E6A", fontWeight: 500, fontSize: "13px",
                  border: "none", cursor: "pointer"
                }}>
                  ← Back
                </button>
              </div>
            )}
          </div>
          <p style={{ textAlign: "center", fontSize: "12px", color: "#8B7E6A", marginTop: "28px" }}>© 2026 KenNick Technologies LLC</p>
        </div>
      </div>
    );
  }

  // ========== MAIN APP ==========
  return (
    <div style={{
      minHeight: "100vh", background: "#FAF7F2", maxWidth: "480px", margin: "0 auto",
      position: "relative", fontFamily: "system-ui, -apple-system, sans-serif",
      boxShadow: "0 0 40px rgba(0,0,0,0.06)"
    }}>
      <header style={{
        background: "#FDF8F0", borderBottom: "1px solid #E8D5A3", padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 20
      }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#6B5B3E" }}>Lumen Driver</div>
          <div style={{
            fontSize: "12px",
            color: driver?.isFounder ? "#C9A86C" : "#8B7E6A",
            fontWeight: driver?.isFounder ? 600 : 400,
            display: "flex",
            alignItems: "center",
            gap: "3px",
            flexWrap: "wrap"
          }}>
            {driver?.isFounder && (
              <span style={{ display: "inline-flex", gap: "1px", marginRight: "2px" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "14px",
                    height: "14px",
                    background: "linear-gradient(145deg, #F0D78C, #C9A86C)",
                    clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
                    position: "relative",
                    flexShrink: 0
                  }}>
                    <span style={{
                      position: "absolute",
                      fontFamily: "'Times New Roman', Times, serif",
                      fontSize: "7px",
                      color: "#3D5C45",
                      fontWeight: 700,
                      lineHeight: 1,
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -42%)"
                    }}>✓</span>
                  </span>
                ))}
              </span>
            )}
            {driver?.username}
          </div>
        </div>
        <button onClick={toggleOnline} disabled={!!activeTrip} style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "7px 14px", borderRadius: "999px",
          fontSize: "13px", fontWeight: 500, border: "none", cursor: activeTrip ? "not-allowed" : "pointer",
          background: isOnline ? "rgba(74,124,89,0.15)" : "#E8D5A3",
          color: isOnline ? "#4A7C59" : "#6B5B3E", opacity: activeTrip ? 0.5 : 1
        }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: isOnline ? "#4A7C59" : "#8B7E6A" }} />
          {isOnline ? "Online" : "Offline"}
        </button>
      </header>

      <main style={{ paddingBottom: "80px" }}>
        {/* DOCUMENTS UPDATE (from Profile) */}
        {view === "documents" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#6B5B3E", margin: "0 0 6px 0" }}>Update Documents</h2>
            <p style={{ fontSize: "13px", color: "#8B7E6A", margin: "0 0 20px 0" }}>
              Re-upload any document that needs renewal or correction.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {DOC_LABELS.map((doc, i) => {
                const status = driver?.verification[doc.key] || "missing";
                const isDone = status === "uploaded" || status === "under_review" || status === "approved";
                return (
                  <div key={doc.key} style={{
                    background: "#FDF8F0", borderRadius: "14px", border: `1px solid ${isDone ? "#C9A86C" : "#E8D5A3"}`,
                    padding: "16px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#3D3429" }}>{i + 1}. {doc.title}</div>
                        <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "3px" }}>{doc.description}</div>
                      </div>
                      <span style={{
                        fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: "999px",
                        background: isDone ? "rgba(74,124,89,0.15)" : "rgba(139,126,106,0.12)",
                        color: isDone ? "#4A7C59" : "#8B7E6A"
                      }}>
                        {isDone ? "On file" : "Missing"}
                      </span>
                    </div>
                    <button onClick={() => updateDoc(doc.key)} style={{
                      width: "100%", padding: "11px", borderRadius: "10px", border: "1px dashed #C9A86C",
                      background: "white", color: "#6B5B3E", fontWeight: 500, fontSize: "13px", cursor: "pointer"
                    }}>
                      {isDone ? "Replace Document" : "Upload Document"}
                    </button>
                  </div>
                );
              })}
            </div>
            {!driver?.isFounder && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6B5B3E", marginBottom: 6 }}>Rental vehicle (optional)</div>
                <div style={{ fontSize: 12, color: "#8B7E6A", marginBottom: 10 }}>
                  Platform can approve a rental if you upload the rental agreement and rental insurance that covers this work.
                </div>
                {[
                  { key: "rental_agreement" as const, title: "Rental agreement" },
                  { key: "rental_insurance" as const, title: "Rental insurance" },
                ].map((doc) => (
                  <button
                    key={doc.key}
                    type="button"
                    onClick={() => {
                      if (!driver) return;
                      const next = { ...driver.verification, [doc.key]: "uploaded" as DocStatus };
                      setDriver({ ...driver, verification: next });
                    }}
                    style={{
                      width: "100%", textAlign: "left", marginBottom: 8, padding: 12,
                      borderRadius: 12, border: "1px solid #E8D5A3", background: "#FDF8F0",
                    }}
                  >
                    {doc.title} · {driver?.verification[doc.key] || "not uploaded"}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setView("profile")} style={{
              width: "100%", marginTop: "20px", padding: "12px", borderRadius: "12px",
              background: "transparent", color: "#8B7E6A", fontWeight: 500, fontSize: "14px",
              border: "1px solid #E8D5A3", cursor: "pointer"
            }}>
              ← Back to Profile
            </button>
          </div>
        )}

        {/* MAP / DRIVE */}
        {view === "map" && (
          <div>
            <DriverMap
              isOnline={isOnline}
              activeTrip={activeTrip}
              statusLabel={activeTrip ? statusText[activeTrip.status] : ""}
              driverGps={driverGps}
            />

            {incomingRequest && !activeTrip && (
              <div style={{ margin: "-24px 16px 0", position: "relative", zIndex: 10 }}>
                <div style={{
                  background: "white", borderRadius: "16px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                  border: "1px solid #E8D5A3", padding: "18px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#C9A86C", fontWeight: 600 }}>NEW TRIP REQUEST</div>
                      <div style={{ fontSize: "18px", fontWeight: 600, color: "#3D3429", marginTop: "2px" }}>{incomingRequest.riderName}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "11px", color: "#8B7E6A", fontWeight: 600 }}>YOUR PAY</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#4A7C59" }}>
                        ${(incomingRequest.fare * 0.7 + (((incomingRequest as { tip?: number }).tip) || 0)).toFixed(2)}
                      </div>
                      <div style={{ fontSize: "11px", color: "#8B7E6A" }}>{incomingRequest.eta}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "14px", color: "#3D3429", lineHeight: 1.6, marginBottom: "16px" }}>
                    <div><strong style={{ color: "#4A7C59" }}>Pickup:</strong> {incomingRequest.pickup}</div>
                    <div><strong style={{ color: "#B85C38" }}>Drop:</strong> {incomingRequest.dropoff}</div>
                    <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "4px" }}>{incomingRequest.distance}</div>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={declineRequest} style={{
                      flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid #E8D5A3",
                      background: "white", color: "#8B7E6A", fontWeight: 500, cursor: "pointer"
                    }}>Decline</button>
                    <button onClick={acceptRequest} style={{
                      flex: 1, padding: "12px", borderRadius: "10px", border: "none",
                      background: "#C9A86C", color: "white", fontWeight: 600, cursor: "pointer"
                    }}>Accept</button>
                  </div>
                </div>
              </div>
            )}

            {activeTrip && activeTrip.status !== "completed" && (
              <div style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 64,
                zIndex: 30,
                maxWidth: 480,
                margin: "0 auto",
                padding: "0 12px",
              }}>
                <div style={{
                  background: "white",
                  borderRadius: "16px 16px 0 0",
                  boxShadow: "0 -6px 24px rgba(0,0,0,0.12)",
                  border: "1px solid #C9A86C",
                  padding: sheetOpen ? "12px 16px 16px" : "8px 16px 12px",
                }}>
                  <button
                    type="button"
                    onClick={() => setSheetOpen((v) => !v)}
                    style={{
                      width: "100%",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "4px 0 8px",
                    }}
                  >
                    <div style={{
                      width: 36, height: 4, borderRadius: 99, background: "#E8D5A3", margin: "0 auto 8px",
                    }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: "12px", color: "#C9A86C", fontWeight: 600, textAlign: "left" }}>
                        {sheetOpen ? "Hide details" : statusText[activeTrip.status]}
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: "#6B5B3E" }}>
                        ${activeTrip.fare.toFixed(2)}
                      </div>
                    </div>
                  </button>
                  {!sheetOpen && (
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button onClick={advanceTrip} style={{
                        flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                        background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "13px", cursor: "pointer"
                      }}>
                        {buttonText[activeTrip.status]}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeTrip.status === "in_progress") advanceTrip();
                          else setEndEarlyOpen(true);
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: "1px solid #C9A86C",
                          background: "transparent",
                          color: "#8B7E6A",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        End trip
                      </button>
                    </div>
                  )}
                  {sheetOpen && (
                  <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", color: "#C9A86C", fontWeight: 600 }}>{statusText[activeTrip.status]}</div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#6B5B3E" }}>${activeTrip.fare.toFixed(2)}</div>
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>{activeTrip.riderName}</div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A", marginBottom: "16px" }}>
                    <div>📍 {activeTrip.pickup}</div>
                    <div>🏁 {activeTrip.dropoff}</div>
                  </div>
                  <button onClick={advanceTrip} style={{
                    width: "100%", padding: "14px", borderRadius: "10px", border: "none",
                    background: "#C9A86C", color: "white", fontWeight: 600, fontSize: "15px", cursor: "pointer"
                  }}>
                    {buttonText[activeTrip.status]}
                  </button>
                  <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeTrip.status === "in_progress") {
                          advanceTrip();
                        } else {
                          setEndEarlyOpen(true);
                        }
                      }}
                      style={{
                        padding: "4px 12px",
                        borderRadius: "999px",
                        border: "1px solid #C9A86C",
                        background: "transparent",
                        color: "#8B7E6A",
                        fontSize: "11px",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      End trip
                    </button>
                  </div>
                  <div style={{ marginTop: 12, borderTop: "1px solid #E8D5A3", paddingTop: 10 }}>
                    {callStatus === "ringing" && callFrom === "rider" && (
                      <div style={{ marginBottom: 8, padding: 10, background: "#FDF8F0", borderRadius: 8, border: "1px solid #C9A86C" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Incoming Lumen call</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" onClick={() => activeTrip && answerPlatformCall(activeTrip.id)}
                            style={{ flex: 1, padding: 8, border: "none", borderRadius: 8, background: "#4A7C59", color: "white", fontWeight: 600 }}>Accept</button>
                          <button type="button" onClick={() => activeTrip && endPlatformCall(activeTrip.id)}
                            style={{ flex: 1, padding: 8, border: "1px solid #B85C38", borderRadius: 8, background: "transparent", color: "#B85C38" }}>Decline</button>
                        </div>
                      </div>
                    )}
                    {callStatus === "active" && (
                      <div style={{ marginBottom: 8, fontSize: 12, color: "#4A7C59", fontWeight: 600 }}>
                        On a Lumen call · numbers hidden
                        <button type="button" onClick={() => activeTrip && endPlatformCall(activeTrip.id)}
                          style={{ marginLeft: 8, padding: "4px 10px", borderRadius: 99, border: "1px solid #B85C38", background: "white", color: "#B85C38", fontSize: 11 }}>Hang up</button>
                      </div>
                    )}
                    {callStatus !== "active" && !(callStatus === "ringing" && callFrom === "rider") && (
                      <button
                        type="button"
                        onClick={() => activeTrip && startPlatformCall(activeTrip.id, "driver")}
                        style={{
                          width: "100%", marginBottom: 8, padding: "10px", borderRadius: 8,
                          border: "1px solid #C9A86C", background: "#FDF8F0", color: "#6B5B3E", fontWeight: 600,
                        }}
                      >
                        Call rider via Lumen
                      </button>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#6B5B3E", marginBottom: 6 }}>Message rider</div>
                    <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 12, marginBottom: 6 }}>
                      {msgs.map((m, i) => (
                        <div key={i} style={{ marginBottom: 4, color: m.sender_role === "driver" ? "#3D3429" : "#4A7C59" }}>
                          <strong>{m.sender_role === "driver" ? "You" : m.sender_name}:</strong> {m.body}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        placeholder="Write a message…"
                        style={{ flex: 1, border: "1px solid #E8D5A3", borderRadius: 8, padding: "8px", fontSize: 13 }}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!msgText.trim() || !activeTrip || !driver) return;
                          try {
                            await sendTripMessage({
                              trip_id: activeTrip.id,
                              sender_role: "driver",
                              sender_name: driver.name,
                              body: msgText,
                            });
                            setMsgText("");
                            const rows = await listTripMessages(activeTrip.id);
                            setMsgs(rows);
                          } catch {}
                        }}
                        style={{ padding: "8px 12px", border: "none", borderRadius: 8, background: "#C9A86C", color: "white", fontWeight: 600, cursor: "pointer" }}
                      >Send</button>
                    </div>
                  </div>
                  {endEarlyOpen && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #E8D5A3" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#3D3429", marginBottom: "6px" }}>
                        Why did this trip end early?
                      </div>
                      <textarea
                        value={earlyReason}
                        onChange={(e) => setEarlyReason(e.target.value)}
                        placeholder="Write the reason…"
                        rows={3}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          border: "1px solid #E8D5A3",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          fontSize: "13px",
                          color: "#3D3429",
                          background: "#FDF8F0",
                          resize: "vertical",
                        }}
                      />
                      <button
                        type="button"
                        onClick={submitEarlyEnd}
                        style={{
                          width: "100%",
                          marginTop: "8px",
                          padding: "10px",
                          borderRadius: "8px",
                          border: "none",
                          background: "#B85C38",
                          color: "white",
                          fontWeight: 600,
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEndEarlyOpen(false); setEarlyReason(""); }}
                        style={{
                          width: "100%",
                          marginTop: "6px",
                          padding: "8px",
                          border: "none",
                          background: "transparent",
                          color: "#8B7E6A",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Back
                      </button>
                    </div>
                  )}
                  </>
                  )}
                </div>
              </div>
            )}

            {activeTrip && activeTrip.status === "completed" && (
              <div style={{ margin: "16px", padding: "18px", borderRadius: "16px", border: "1px solid #E8D5A3", background: "#FDF8F0" }}>
                <div style={{ fontWeight: 600, color: "#3D3429", marginBottom: "8px" }}>Trip complete</div>
                <div style={{ fontSize: "13px", color: "#8B7E6A", marginBottom: "10px" }}>
                  {driverRated ? "Rating submitted" : "Choose hearts, then Submit (1 poor · 6 excellent)"}
                </div>
                <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                  {[1,2,3,4,5,6].map((h) => (
                    <button key={h} type="button" disabled={driverRated}
                      onClick={() => setDriverRating(h)}
                      style={{
                        fontSize: "28px", border: "none", background: "transparent",
                        cursor: driverRated ? "default" : "pointer",
                        color: h <= driverRating ? "#C9A86C" : "#E8D5A3",
                        textShadow: h <= driverRating ? "0 0 6px rgba(201,168,108,0.55)" : "none",
                        lineHeight: 1, padding: "4px",
                      }}
                    >♥</button>
                  ))}
                </div>
                {!driverRated ? (
                  <button
                    disabled={driverRating < 1}
                    onClick={async () => {
                      if (driverRating < 1) return;
                      if (tripsConfigured()) {
                        try { await rateTrip(activeTrip.id, driverRating, "rider"); } catch (e) { console.error(e); }
                      }
                      setDriverRated(true);
                    }}
                    style={{
                      width: "100%", marginTop: "14px", padding: "12px", borderRadius: "10px", border: "none",
                      background: driverRating < 1 ? "#E8D5A3" : "#C9A86C", color: "white", fontWeight: 600,
                      cursor: driverRating < 1 ? "not-allowed" : "pointer"
                    }}
                  >Submit rating</button>
                ) : (
                  <button onClick={() => { setActiveTrip(null); setDriverRated(false); setDriverRating(0); }}
                    style={{ width: "100%", marginTop: "14px", padding: "12px", borderRadius: "10px", border: "none", background: "#C9A86C", color: "white", fontWeight: 600, cursor: "pointer" }}>
                    Done
                  </button>
                )}
              </div>
            )}

            {!activeTrip && !incomingRequest && (
              <div style={{ padding: "24px 16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                  <div style={{ background: "#FDF8F0", borderRadius: "12px", padding: "16px", border: "1px solid #E8D5A3" }}>
                    <div style={{ fontSize: "12px", color: "#8B7E6A" }}>Today</div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#6B5B3E", marginTop: "4px" }}>
                      ${driver?.earningsToday.toFixed(2) || "0.00"}
                    </div>
                  </div>
                  <div style={{ background: "#FDF8F0", borderRadius: "12px", padding: "16px", border: "1px solid #E8D5A3" }}>
                    <div style={{ fontSize: "12px", color: "#8B7E6A" }}>Trips</div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: "#6B5B3E", marginTop: "4px" }}>
                      {tripHistory.length}
                    </div>
                  </div>
                </div>
                {isOnline && (
                  !tripsConfigured() ? (
                    <button onClick={simulateRequest} style={{
                      width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #E8D5A3",
                      background: "#FDF8F0", color: "#8B7E6A", fontWeight: 500, cursor: "pointer", marginTop: "8px"
                    }}>Demo request (offline only)</button>
                  ) : (
                    <div style={{ fontSize: "12px", color: "#4A7C59", textAlign: "center", marginTop: "8px" }}>
                      Live matching on — waiting for Request trips
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {view === "earnings" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3D3429", margin: "0 0 16px" }}>Your earnings</h2>
            <div style={{ background: "#FDF8F0", borderRadius: "16px", border: "1px solid #E8D5A3", padding: "18px", marginBottom: "14px" }}>
              <div style={{ fontSize: "12px", color: "#8B7E6A" }}>Today (your pay only)</div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: "#4A7C59", marginTop: "4px" }}>
                ${driver?.earningsToday.toFixed(2) || "0.00"}
              </div>
              <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "6px" }}>
                Available balance from completed trips
              </div>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#6B5B3E", marginBottom: "10px" }}>This week</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px", marginBottom: "16px" }}>
              {["S","M","T","W","T","F","S"].map((d, i) => {
                const amt = i === new Date().getDay() ? (driver?.earningsToday || 0) : 0;
                return (
                  <div key={d + i} style={{
                    textAlign: "center", padding: "10px 4px", borderRadius: "10px",
                    background: amt > 0 ? "rgba(201,168,108,0.2)" : "#FDF8F0",
                    border: "1px solid #E8D5A3"
                  }}>
                    <div style={{ fontSize: "11px", color: "#8B7E6A" }}>{d}</div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#6B5B3E", marginTop: "4px" }}>
                      ${amt.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setView("payout")} style={{
              width: "100%", padding: "14px", borderRadius: "12px", border: "none",
              background: "#C9A86C", color: "white", fontWeight: 600, marginBottom: "10px", cursor: "pointer"
            }}>Cash out</button>
            <div style={{ fontSize: "12px", color: "#8B7E6A", textAlign: "center" }}>
              Daily cash out or weekly payout · bank / debit
            </div>
          </div>
        )}

        {view === "payout" && (
          <div style={{ padding: "20px 16px" }}>
            <button onClick={() => setView("profile")} style={{ border: "none", background: "none", color: "#C9A86C", marginBottom: "12px", cursor: "pointer" }}>← Back</button>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3D3429", margin: "0 0 8px" }}>Payout</h2>
            <p style={{ fontSize: 13, color: "#8B7E6A", margin: "0 0 16px" }}>
              Connect Stripe once. You get 70% of the fare plus 100% of the tip. Platform keeps 30%.
            </p>
            {driver?.stripeAccountId ? (
              <div style={{ padding: 16, border: "1px solid #E8D5A3", borderRadius: 12, background: "#FDF8F0", marginBottom: 14, fontSize: 13, color: "#4A7C59" }}>
                Stripe connected
              </div>
            ) : (
              <div style={{ padding: 16, border: "1px dashed #E8D5A3", borderRadius: 12, marginBottom: 14, fontSize: 13, color: "#8B7E6A" }}>
                Not connected yet
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!driver) return;
                const res = await fetch("/api/stripe/connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    driverId: driver.id,
                    email: driver.email,
                    accountId: driver.stripeAccountId || "",
                  }),
                });
                const data = await res.json();
                if (data.accountId) {
                  setDriver({ ...driver, stripeAccountId: data.accountId });
                }
                if (data.url) window.location.href = data.url;
              }}
              style={{ width: "100%", padding: 14, border: "none", borderRadius: 10, background: "#C9A86C", color: "white", fontWeight: 600 }}
            >
              {driver?.stripeAccountId ? "Open Stripe" : "Connect Stripe to get paid"}
            </button>
          </div>
        )}

        {view === "history" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#6B5B3E", margin: "0 0 16px 0" }}>Trip History</h2>
            {tripHistory.length === 0 ? (
              <p style={{ textAlign: "center", color: "#8B7E6A", padding: "40px 0", fontSize: "14px" }}>No trips yet</p>
            ) : (
              tripHistory.map((t) => (
                <div key={t.id} style={{
                  background: "#FDF8F0", borderRadius: "12px", padding: "14px",
                  border: "1px solid #E8D5A3", marginBottom: "10px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{t.riderName}</div>
                      <div style={{ fontSize: "12px", color: "#8B7E6A" }}>
                        {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, color: "#6B5B3E" }}>${t.fare.toFixed(2)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === "profile" && (
          <div style={{ padding: "12px 0 24px" }}>
            <div style={{ padding: "8px 16px 16px" }}>
              <h2 style={{ fontSize: "28px", fontWeight: 700, color: "#3D3429", margin: 0 }}>Account</h2>
              <div style={{ fontSize: "14px", color: "#8B7E6A", marginTop: "6px" }}>
                {driver?.name} · {driver?.username}
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 72, height: 72, borderRadius: "50%", overflow: "hidden",
                  background: "#E8D5A3", border: "2px solid #C9A86C", flexShrink: 0,
                }}>
                  {driver?.photo ? (
                    <img src={driver.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>👤</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, color: "#6B5B3E", fontWeight: 600, marginBottom: 6 }}>
                    Profile photo (riders see this)
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f || !driver) return;
                      const r = new FileReader();
                      r.onload = () => {
                        const img = new Image();
                        img.onload = async () => {
                          const c = document.createElement("canvas");
                          c.width = 240;
                          c.height = 240;
                          const ctx = c.getContext("2d");
                          if (!ctx) return;
                          const s = Math.min(img.width, img.height);
                          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 240, 240);
                          const localPhoto = c.toDataURL("image/jpeg", 0.78);
                          const saveLocal = (photo: string) => {
                            const updated = { ...driver, photo };
                            setDriver(updated);
                            try {
                              localStorage.setItem("lumen_driver_photo_" + driver.id, photo);
                              const existing = localStorage.getItem("lumen_drivers");
                              const drivers: Driver[] = existing ? JSON.parse(existing) : [];
                              const idx = drivers.findIndex((d) => d.id === driver.id);
                              if (idx >= 0) {
                                drivers[idx] = updated;
                                localStorage.setItem("lumen_drivers", JSON.stringify(drivers));
                              }
                            } catch {}
                          };
                          saveLocal(localPhoto);
                          c.toBlob(async (blob) => {
                            if (!blob) return;
                            try {
                              const url = await uploadDriverPhoto(driver.id, blob);
                              saveLocal(url);
                            } catch (err) {
                              setError("Photo saved on this device. Cloud bucket: " + String(err).slice(0, 80));
                            }
                          }, "image/jpeg", 0.78);
                        };
                        img.src = String(r.result);
                      };
                      r.readAsDataURL(f);
                    }}
                  />
                  <input
                    placeholder="Your phone (masked for riders)"
                    value={driver?.phone || ""}
                    onChange={(e) => {
                      if (!driver) return;
                      const updated = { ...driver, phone: e.target.value };
                      setDriver(updated);
                      localStorage.setItem("lumen_driver_session", JSON.stringify(updated));
                    }}
                    style={{
                      display: "block", marginTop: 8, width: 200, padding: "6px 8px",
                      border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 13,
                    }}
                  />
                  {driver?.phone ? (
                    <div style={{ fontSize: 11, color: "#8B7E6A", marginTop: 4 }}>Riders see {maskPhone(driver.phone)}</div>
                  ) : null}
                  <input
                    placeholder="Car make"
                    value={driver?.make || ""}
                    onChange={(e) => {
                      if (!driver) return;
                      const make = e.target.value;
                      const updated = { ...driver, make, vehicle: [make, driver.model].filter(Boolean).join(" · ") };
                      setDriver(updated);
                      localStorage.setItem("lumen_driver_session", JSON.stringify(updated));
                    }}
                    style={{ display: "block", marginTop: 8, width: 200, padding: "6px 8px", border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 13 }}
                  />
                  <input
                    placeholder="Car model"
                    value={driver?.model || ""}
                    onChange={(e) => {
                      if (!driver) return;
                      const model = e.target.value;
                      const updated = { ...driver, model, vehicle: [driver.make, model, driver.color].filter(Boolean).join(" · ") };
                      setDriver(updated);
                      localStorage.setItem("lumen_driver_session", JSON.stringify(updated));
                    }}
                    style={{ display: "block", marginTop: 8, width: 200, padding: "6px 8px", border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 13 }}
                  />
                  <input
                    placeholder="Car color"
                    value={driver?.color || ""}
                    onChange={(e) => {
                      if (!driver) return;
                      const color = e.target.value;
                      const updated = { ...driver, color, vehicle: [driver.make, driver.model, color].filter(Boolean).join(" · ") };
                      setDriver(updated);
                      localStorage.setItem("lumen_driver_session", JSON.stringify(updated));
                    }}
                    style={{ display: "block", marginTop: 8, width: 200, padding: "6px 8px", border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 13 }}
                  />
                  <input
                    placeholder="Registration / plate"
                    value={driver?.plate || ""}
                    onChange={(e) => {
                      if (!driver) return;
                      const updated = { ...driver, plate: e.target.value };
                      setDriver(updated);
                      localStorage.setItem("lumen_driver_session", JSON.stringify(updated));
                    }}
                    style={{ display: "block", marginTop: 8, width: 200, padding: "6px 8px", border: "1px solid #E8D5A3", borderRadius: 8, fontSize: 13 }}
                  />
                </div>
              </div>
            </div>
            {[
              { key: "vehicles", label: "Vehicles", sub: (driver?.vehicle || "") + " · " + (driver?.plate || ""), icon: "🚗", go: "profile" },
              { key: "docs", label: "Documents", sub: "Registration · insurance · license", icon: "📄", go: "documents" },
              { key: "pay", label: "Payment & payouts", sub: "Daily or weekly cash out", icon: "💳", go: "payout" },
              { key: "earn", label: "Earnings", sub: "Today and week by day", icon: "📊", go: "earnings" },
              { key: "support", label: "Support & lost items", sub: "Trip help · lost & found · safety", icon: "💬", go: "support" },
              { key: "hist", label: "Trip history", sub: "Past trips", icon: "🕒", go: "history" },
            ].map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => setView(row.go as typeof view)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "14px",
                  padding: "16px", border: "none", borderBottom: "1px solid #F0E6D4",
                  background: "white", textAlign: "left", cursor: "pointer"
                }}
              >
                <span style={{ fontSize: "22px", width: "36px", textAlign: "center" }}>{row.icon}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a" }}>{row.label}</div>
                  <div style={{ fontSize: "13px", color: "#8B7E6A", marginTop: "2px" }}>{row.sub}</div>
                </span>
                <span style={{ color: "#C9A86C", fontSize: "18px" }}>›</span>
              </button>
            ))}
            <div style={{ padding: "20px 16px" }}>
              <button onClick={handleLogout} style={{
                width: "100%", padding: "14px", borderRadius: "12px",
                border: "1px solid #E8D5A3", background: "#FDF8F0",
                color: "#B85C38", fontWeight: 600, cursor: "pointer"
              }}>Log off</button>
              <p style={{ textAlign: "center", fontSize: "11px", color: "#8B7E6A", marginTop: "16px" }}>
                © 2026 KenNick Technologies LLC
              </p>
            </div>
          </div>
        )}

        {view === "support" && (
          <div style={{ padding: "20px 16px 28px" }}>
            <button onClick={() => setView("profile")} style={{ border: "none", background: "none", color: "#C9A86C", cursor: "pointer", marginBottom: "12px" }}>← Account</button>
            <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#3D3429", margin: "0 0 8px" }}>Support</h2>
            <p style={{ fontSize: 13, color: "#8B7E6A", margin: "0 0 16px" }}>All messages go to Lumen support. Pick a category and describe the problem.</p>
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Name</label>
            <input value={supportForm.name || driver?.name || ""} onChange={(e) => setSupportForm({ ...supportForm, name: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Email</label>
            <input value={supportForm.email || driver?.email || ""} onChange={(e) => setSupportForm({ ...supportForm, email: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Phone</label>
            <input value={supportForm.phone || driver?.phone || ""} onChange={(e) => setSupportForm({ ...supportForm, phone: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Category</label>
            <select value={supportForm.category} onChange={(e) => setSupportForm({ ...supportForm, category: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3", background: "white" }}>
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.title} — {c.detail}</option>
              ))}
            </select>
            <label style={{ display: "block", fontSize: 12, color: "#8B7E6A", marginBottom: 4 }}>Message</label>
            <textarea value={supportForm.message} onChange={(e) => setSupportForm({ ...supportForm, message: e.target.value })}
              rows={5} placeholder="Describe the problem"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid #E8D5A3" }} />
            {supportNote ? <div style={{ fontSize: 13, color: "#4A7C59", marginBottom: 10 }}>{supportNote}</div> : null}
            <button
              type="button"
              onClick={async () => {
                const name = supportForm.name || driver?.name || "";
                const email = supportForm.email || driver?.email || "";
                const phone = supportForm.phone || driver?.phone || "";
                if (!name || !email || !supportForm.message.trim()) {
                  setSupportNote("Name, email, and message are required.");
                  return;
                }
                await sendSupportTicket({
                  role: "driver",
                  name,
                  email,
                  phone,
                  category: supportForm.category,
                  message: supportForm.message,
                });
                setSupportNote("Sent to support.");
                setSupportForm({ ...supportForm, message: "" });
              }}
              style={{ width: "100%", padding: 14, border: "none", borderRadius: 10, background: "#C9A86C", color: "white", fontWeight: 600 }}
            >Send to support</button>
          </div>
        )}
        {view === "ratings" && (
          <div style={{ padding: "20px 16px 24px" }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#3D3429", margin: "0 0 6px" }}>Rider ratings</h2>
            <div style={{ fontSize: 13, color: "#8B7E6A", marginBottom: 18 }}>
              Last 250 trips · {ratingSample} rated
            </div>
            {[6, 5, 4, 3, 2, 1].map((n) => {
              const max = Math.max(1, ...ratingCounts.slice(1));
              const count = ratingCounts[n] || 0;
              return (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 88, display: "flex", gap: 1, justifyContent: "flex-end" }}>
                    {Array.from({ length: n }).map((_, i) => (
                      <span key={i} style={{ color: "#C9A86C", fontSize: 12 }}>♥</span>
                    ))}
                  </div>
                  <div style={{ flex: 1, height: 10, background: "#F0E6D4", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      width: (count / max) * 100 + "%",
                      height: "100%",
                      background: "#C9A86C",
                    }} />
                  </div>
                  <div style={{ width: 36, textAlign: "right", fontSize: 14, fontWeight: 700, color: "#3D3429" }}>
                    {count}
                  </div>
                </div>
              );
            })}
            <p style={{ fontSize: 12, color: "#8B7E6A", marginTop: 16 }}>
              6 hearts is top. 1 heart is poor. Counts are from riders after each trip.
            </p>
          </div>
        )}
      </main>

      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: "480px", margin: "0 auto",
        background: "#FDF8F0", borderTop: "1px solid #E8D5A3",
        display: "flex", justifyContent: "space-around", padding: "10px 0", zIndex: 30
      }}>
        {[
          { id: "map" as const, label: "Drive", icon: "📍" },
          { id: "earnings" as const, label: "Earn", icon: "💰" },
          { id: "history" as const, label: "Trips", icon: "📋" },
          { id: "ratings" as const, label: "Rate", icon: "♥" },
          { id: "profile" as const, label: "Profile", icon: "👤" },
        ].map((item) => (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            background: view === item.id ? "rgba(201,168,108,0.2)" : "transparent",
            border: "none", borderRadius: "10px", padding: "8px 16px", cursor: "pointer",
            color: view === item.id ? "#6B5B3E" : "#8B7E6A", fontSize: "11px", fontWeight: 500,
            display: "flex", flexDirection: "column", alignItems: "center", gap: "2px"
          }}>
            <span style={{ fontSize: "18px" }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
