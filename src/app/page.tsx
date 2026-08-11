"use client";

import { useState, useEffect } from "react";

type TripStatus = "pending" | "accepted" | "navigating" | "arrived" | "in_progress" | "completed";

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

interface Driver {
  name: string;
  username: string;
  rating: number;
  totalTrips: number;
  earningsToday: number;
  vehicle: string;
  plate: string;
}

const DEMO_DRIVER: Driver = {
  name: "Nikolay Sapoundjiev",
  username: "@thevip",
  rating: 4.98,
  totalTrips: 1284,
  earningsToday: 0,
  vehicle: "Tesla Model S · Pearl White",
  plate: "LUMEN-1",
};

const SAMPLE_REQUESTS = [
  { riderName: "Kendall N.", pickup: "Hyde Park Village, Tampa", dropoff: "Tampa International Airport", distance: "8.2 mi", fare: 24.5, eta: "4 min" },
  { riderName: "Mike A.", pickup: "Channelside Drive", dropoff: "Ybor City", distance: "3.1 mi", fare: 12.8, eta: "2 min" },
  { riderName: "Sam S.", pickup: "Bayshore Blvd", dropoff: "Westshore Plaza", distance: "5.4 mi", fare: 18.2, eta: "6 min" },
  { riderName: "Alex R.", pickup: "University of Tampa", dropoff: "South Tampa", distance: "2.7 mi", fare: 9.5, eta: "3 min" },
];

function generateId() {
  return "trip_" + Math.random().toString(36).slice(2, 9);
}

export default function LumenDriver() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<Trip | null>(null);
  const [tripHistory, setTripHistory] = useState<Trip[]>([]);
  const [view, setView] = useState<"map" | "earnings" | "history" | "profile">("map");

  // Clear any old session on first load of this new version
  useEffect(() => {
    // Force clean start - remove old session
    localStorage.removeItem("lumen_driver_session");
  }, []);

  const handleDemoLogin = () => {
    setDriver(DEMO_DRIVER);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("lumen_driver_session");
    setIsLoggedIn(false);
    setDriver(null);
    setIsOnline(false);
    setActiveTrip(null);
    setIncomingRequest(null);
    setView("map");
  };

  const toggleOnline = () => {
    if (activeTrip) return;
    setIsOnline((v) => !v);
    if (isOnline) setIncomingRequest(null);
  };

  const simulateRequest = () => {
    if (!isOnline || activeTrip || incomingRequest) return;
    const sample = SAMPLE_REQUESTS[Math.floor(Math.random() * SAMPLE_REQUESTS.length)];
    setIncomingRequest({
      ...sample,
      id: generateId(),
      status: "pending",
      timestamp: Date.now(),
    });
  };

  const acceptRequest = () => {
    if (!incomingRequest) return;
    setActiveTrip({ ...incomingRequest, status: "accepted" });
    setIncomingRequest(null);
  };

  const declineRequest = () => {
    setIncomingRequest(null);
  };

  const advanceTrip = () => {
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
      setActiveTrip(null);
    } else if (next) {
      setActiveTrip({ ...activeTrip, status: next });
    }
  };

  const statusText: Record<string, string> = {
    accepted: "Accepted — Navigate to pickup",
    navigating: "Navigating to pickup",
    arrived: "Arrived at pickup",
    in_progress: "Trip in progress",
  };

  const buttonText: Record<string, string> = {
    accepted: "Start Navigation",
    navigating: "I've Arrived",
    arrived: "Start Trip",
    in_progress: "Complete Trip",
  };

  // ========== LOGIN SCREEN ==========
  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#FAF7F2",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      }}>
        <div style={{ width: "100%", maxWidth: "360px", textAlign: "center" }}>
          <h1 style={{
            fontSize: "28px",
            fontWeight: 600,
            color: "#6B5B3E",
            margin: "0 0 8px 0"
          }}>
            Lumen Driver
          </h1>
          <p style={{ fontSize: "14px", color: "#8B7E6A", margin: "0 0 40px 0" }}>
            KenNick Technologies LLC
          </p>

          <div style={{
            background: "#FDF8F0",
            borderRadius: "16px",
            border: "1px solid #E8D5A3",
            padding: "28px 24px",
            textAlign: "left"
          }}>
            <button
              onClick={handleDemoLogin}
              style={{
                width: "100%",
                padding: "16px",
                borderRadius: "12px",
                background: "#C9A86C",
                color: "white",
                fontWeight: 600,
                fontSize: "16px",
                border: "none",
                cursor: "pointer"
              }}
            >
              Demo Login · @thevip
            </button>

            <p style={{
              fontSize: "12px",
              color: "#8B7E6A",
              textAlign: "center",
              marginTop: "20px",
              marginBottom: 0
            }}>
              MVP · Driver only
            </p>
          </div>

          <p style={{
            fontSize: "12px",
            color: "#8B7E6A",
            marginTop: "40px"
          }}>
            © 2026 KenNick Technologies LLC
          </p>
        </div>
      </div>
    );
  }

  // ========== MAIN APP ==========
  return (
    <div style={{
      minHeight: "100vh",
      background: "#FAF7F2",
      maxWidth: "480px",
      margin: "0 auto",
      position: "relative",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      boxShadow: "0 0 40px rgba(0,0,0,0.06)"
    }}>
      {/* Header */}
      <header style={{
        background: "#FDF8F0",
        borderBottom: "1px solid #E8D5A3",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 20
      }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#6B5B3E" }}>Lumen Driver</div>
          <div style={{ fontSize: "12px", color: "#8B7E6A" }}>{driver?.username}</div>
        </div>

        <button
          onClick={toggleOnline}
          disabled={!!activeTrip}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "7px 14px",
            borderRadius: "999px",
            fontSize: "13px",
            fontWeight: 500,
            border: "none",
            cursor: activeTrip ? "not-allowed" : "pointer",
            background: isOnline ? "rgba(74,124,89,0.15)" : "#E8D5A3",
            color: isOnline ? "#4A7C59" : "#6B5B3E",
            opacity: activeTrip ? 0.5 : 1
          }}
        >
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: isOnline ? "#4A7C59" : "#8B7E6A"
          }} />
          {isOnline ? "Online" : "Offline"}
        </button>
      </header>

      <main style={{ paddingBottom: "80px" }}>
        {view === "map" && (
          <div>
            {/* Map area */}
            <div style={{
              height: "220px",
              background: "linear-gradient(160deg, #E8D5A3, #F5E8D3 40%, #D4C4A8)",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "#C9A86C",
                  border: "4px solid white",
                  margin: "0 auto 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
                }}>
                  <span style={{ color: "white", fontSize: "18px" }}>📍</span>
                </div>
                <div style={{
                  background: "white",
                  padding: "4px 12px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#6B5B3E",
                  display: "inline-block"
                }}>
                  You · Tampa
                </div>
              </div>

              <div style={{
                position: "absolute",
                top: "12px",
                left: "12px",
                right: "12px",
                background: "rgba(255,255,255,0.92)",
                borderRadius: "10px",
                padding: "10px 14px",
                fontSize: "13px"
              }}>
                {activeTrip ? (
                  <span style={{ color: "#6B5B3E", fontWeight: 500 }}>{statusText[activeTrip.status]}</span>
                ) : isOnline ? (
                  <span style={{ color: "#4A7C59" }}>Listening for requests…</span>
                ) : (
                  <span style={{ color: "#8B7E6A" }}>Go Online to receive trips</span>
                )}
              </div>
            </div>

            {/* Incoming Request Card */}
            {incomingRequest && !activeTrip && (
              <div style={{ margin: "-24px 16px 0", position: "relative", zIndex: 10 }}>
                <div style={{
                  background: "white",
                  borderRadius: "16px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                  border: "1px solid #E8D5A3",
                  padding: "18px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#C9A86C", fontWeight: 600, letterSpacing: "0.04em" }}>NEW TRIP REQUEST</div>
                      <div style={{ fontSize: "18px", fontWeight: 600, color: "#3D3429", marginTop: "2px" }}>{incomingRequest.riderName}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#6B5B3E" }}>${incomingRequest.fare.toFixed(2)}</div>
                      <div style={{ fontSize: "12px", color: "#8B7E6A" }}>{incomingRequest.eta}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: "14px", color: "#3D3429", lineHeight: 1.6, marginBottom: "16px" }}>
                    <div><strong style={{ color: "#4A7C59" }}>Pickup:</strong> {incomingRequest.pickup}</div>
                    <div><strong style={{ color: "#B85C38" }}>Drop:</strong> {incomingRequest.dropoff}</div>
                    <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "4px" }}>{incomingRequest.distance}</div>
                  </div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={declineRequest} style={{
                      flex: 1, padding: "12px", borderRadius: "10px",
                      border: "1px solid #E8D5A3", background: "white",
                      color: "#8B7E6A", fontWeight: 500, cursor: "pointer"
                    }}>Decline</button>
                    <button onClick={acceptRequest} style={{
                      flex: 1, padding: "12px", borderRadius: "10px",
                      border: "none", background: "#C9A86C",
                      color: "white", fontWeight: 600, cursor: "pointer"
                    }}>Accept</button>
                  </div>
                </div>
              </div>
            )}

            {/* Active Trip Card */}
            {activeTrip && (
              <div style={{ margin: "-24px 16px 0", position: "relative", zIndex: 10 }}>
                <div style={{
                  background: "white",
                  borderRadius: "16px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                  border: "1px solid #C9A86C",
                  padding: "18px"
                }}>
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
                    width: "100%", padding: "14px", borderRadius: "10px",
                    border: "none", background: "#C9A86C",
                    color: "white", fontWeight: 600, fontSize: "15px", cursor: "pointer"
                  }}>
                    {buttonText[activeTrip.status]}
                  </button>
                </div>
              </div>
            )}

            {/* Idle state */}
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
                  <button onClick={simulateRequest} style={{
                    width: "100%", padding: "14px", borderRadius: "12px",
                    border: "2px dashed #C9A86C", background: "transparent",
                    color: "#6B5B3E", fontWeight: 500, fontSize: "14px", cursor: "pointer"
                  }}>
                    Simulate Incoming Request
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {view === "earnings" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#6B5B3E", margin: "0 0 16px 0" }}>Earnings</h2>
            <div style={{
              background: "linear-gradient(135deg, #C9A86C, #6B5B3E)",
              borderRadius: "16px", padding: "24px", color: "white", marginBottom: "16px"
            }}>
              <div style={{ fontSize: "14px", opacity: 0.9 }}>Today&apos;s Earnings</div>
              <div style={{ fontSize: "36px", fontWeight: 700, marginTop: "4px" }}>
                ${driver?.earningsToday.toFixed(2) || "0.00"}
              </div>
              <div style={{ fontSize: "13px", opacity: 0.8, marginTop: "8px" }}>
                {tripHistory.length} trips completed
              </div>
            </div>
            <div style={{ background: "#FDF8F0", borderRadius: "12px", padding: "16px", border: "1px solid #E8D5A3" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "14px" }}>
                <span style={{ color: "#8B7E6A" }}>Lifetime trips</span>
                <span style={{ fontWeight: 500 }}>{driver?.totalTrips}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "14px" }}>
                <span style={{ color: "#8B7E6A" }}>Rating</span>
                <span style={{ fontWeight: 500 }}>★ {driver?.rating}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                <span style={{ color: "#8B7E6A" }}>Vehicle</span>
                <span style={{ fontWeight: 500 }}>{driver?.vehicle}</span>
              </div>
            </div>
          </div>
        )}

        {view === "history" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#6B5B3E", margin: "0 0 16px 0" }}>Trip History</h2>
            {tripHistory.length === 0 ? (
              <p style={{ textAlign: "center", color: "#8B7E6A", padding: "40px 0", fontSize: "14px" }}>
                No trips yet
              </p>
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
                  <div style={{ fontSize: "12px", color: "#8B7E6A", marginTop: "6px" }}>
                    {t.pickup} → {t.dropoff}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === "profile" && (
          <div style={{ padding: "20px 16px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#6B5B3E", margin: "0 0 4px 0" }}>
                {driver?.name}
              </h2>
              <p style={{ fontSize: "14px", color: "#8B7E6A", margin: 0 }}>{driver?.username}</p>
              <p style={{ fontSize: "14px", color: "#6B5B3E", marginTop: "8px" }}>
                ★ {driver?.rating} · {driver?.totalTrips} trips
              </p>
            </div>

            <div style={{
              background: "#FDF8F0", borderRadius: "12px", padding: "16px",
              border: "1px solid #E8D5A3", marginBottom: "16px", fontSize: "14px"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: "#8B7E6A" }}>Company</span>
                <span style={{ fontWeight: 500 }}>KenNick Technologies LLC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: "#8B7E6A" }}>Owner</span>
                <span style={{ fontWeight: 500 }}>@thevip</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: "#8B7E6A" }}>Co-founder</span>
                <span style={{ fontWeight: 500 }}>@kendall.vip</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#8B7E6A" }}>Plate</span>
                <span style={{ fontWeight: 500 }}>{driver?.plate}</span>
              </div>
            </div>

            <button onClick={handleLogout} style={{
              width: "100%", padding: "14px", borderRadius: "12px",
              border: "1px solid #B85C38", background: "transparent",
              color: "#B85C38", fontWeight: 500, cursor: "pointer"
            }}>
              Sign Out
            </button>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        maxWidth: "480px", margin: "0 auto",
        background: "#FDF8F0", borderTop: "1px solid #E8D5A3",
        display: "flex", justifyContent: "space-around",
        padding: "10px 0", zIndex: 30
      }}>
        {[
          { id: "map" as const, label: "Drive", icon: "📍" },
          { id: "earnings" as const, label: "Earn", icon: "💰" },
          { id: "history" as const, label: "Trips", icon: "📋" },
          { id: "profile" as const, label: "Profile", icon: "👤" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              background: view === item.id ? "rgba(201,168,108,0.2)" : "transparent",
              border: "none",
              borderRadius: "10px",
              padding: "8px 16px",
              cursor: "pointer",
              color: view === item.id ? "#6B5B3E" : "#8B7E6A",
              fontSize: "11px",
              fontWeight: 500,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px"
            }}
          >
            <span style={{ fontSize: "18px" }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
