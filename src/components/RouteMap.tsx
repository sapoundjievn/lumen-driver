"use client";

import { useEffect, useRef } from "react";
import { geocode, fetchRoute, ST_PETE, type Coords } from "../lib/navigation";

type Props = {
  pickup: string;
  dropoff: string;
  phase: "idle" | "to_pickup" | "to_dropoff" | "full";
  driverLat?: number;
  driverLng?: number;
  height?: number;
  onStats?: (s: {
    miles: number;
    minutes: number;
    steps?: { text: string; miles: number }[];
  } | null) => void;
};

declare global {
  interface Window {
    L?: any;
  }
}

function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.L) return resolve(window.L);
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.querySelector("script[data-leaflet]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L));
      if (window.L) resolve(window.L);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.dataset.leaflet = "1";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("leaflet load failed"));
    document.body.appendChild(script);
  });
}

const LIGHT_TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const LINE = "#2563EB";
const GLOW = "#93C5FD";

export default function RouteMap({
  pickup,
  dropoff,
  phase,
  driverLat,
  driverLng,
  height = 280,
  onStats,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const tileRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const pickupCRef = useRef<Coords | null>(null);
  const dropCRef = useRef<Coords | null>(null);
  const routeBoundsRef = useRef<any>(null);
  const followRef = useRef(false);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  // Build map + pickup/drop + route once per address/phase (NOT on every GPS tick)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = L.map(containerRef.current, {
            zoomControl: false,
            attributionControl: true,
            dragging: true,
            touchZoom: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: true,
            keyboard: true,
            bounceAtZoomLimits: true,
          }).setView([ST_PETE.lat, ST_PETE.lon], 13);
        }
        try {
          mapRef.current.zoomControl?.remove();
        } catch {}
        const map = mapRef.current;

        if (!tileRef.current) {
          tileRef.current = L.tileLayer(LIGHT_TILE, {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap",
          }).addTo(map);
        }

        if (layerRef.current) {
          layerRef.current.clearLayers();
        } else {
          layerRef.current = L.layerGroup().addTo(map);
        }
        const layers = layerRef.current;

        const pickupC = (await geocode(pickup)) || ST_PETE;
        const dropC = (await geocode(dropoff)) || ST_PETE;
        if (cancelled) return;
        pickupCRef.current = pickupC;
        dropCRef.current = dropC;

        const mk = (color: string, size = 14) =>
          L.divIcon({
            className: "",
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });

        L.marker([pickupC.lat, pickupC.lon], { icon: mk("#4A7C59") })
          .addTo(layers)
          .bindPopup("Pickup: " + pickup);
        L.marker([dropC.lat, dropC.lon], { icon: mk("#B85C38") })
          .addTo(layers)
          .bindPopup("Dropoff: " + dropoff);

        const driverC = {
          lat: driverLat ?? ST_PETE.lat,
          lon: driverLng ?? ST_PETE.lon,
        };
        if (driverMarkerRef.current) {
          try {
            map.removeLayer(driverMarkerRef.current);
          } catch {}
        }
        driverMarkerRef.current = L.marker([driverC.lat, driverC.lon], {
          icon: mk("#2563EB", 12),
        })
          .addTo(map)
          .bindPopup("You");

        const drawPath = (path: [number, number][], color: string, weight: number) => {
          L.polyline(path, {
            color: GLOW,
            weight: weight + 3,
            opacity: 0.3,
            lineJoin: "round",
          }).addTo(layers);
          return L.polyline(path, {
            color,
            weight,
            opacity: 1,
            lineJoin: "round",
          }).addTo(layers);
        };

        if (phase === "full") {
          const r1 = await fetchRoute(driverC, pickupC);
          const r2 = await fetchRoute(pickupC, dropC);
          if (cancelled) return;
          const bounds: any[] = [];
          let miles = 0;
          let minutes = 0;
          const steps: { text: string; miles: number }[] = [];
          if (r1 && r1.path.length > 1) {
            const line = drawPath(r1.path, LINE, 5);
            bounds.push(line.getBounds());
            miles += r1.miles;
            minutes += r1.minutes;
            steps.push({ text: "To pickup", miles: r1.miles });
            (r1.steps || []).slice(0, 6).forEach((s) => steps.push(s));
          }
          if (r2 && r2.path.length > 1) {
            const line = drawPath(r2.path, "#1D4ED8", 5);
            bounds.push(line.getBounds());
            miles += r2.miles;
            minutes += r2.minutes;
            steps.push({ text: "Pickup → dropoff", miles: r2.miles });
            (r2.steps || []).slice(0, 8).forEach((s) => steps.push(s));
          }
          if (bounds.length) {
            let all = bounds[0];
            bounds.slice(1).forEach((b) => {
              all = all.extend(b);
            });
            routeBoundsRef.current = all;
            map.fitBounds(all, { padding: [36, 36] });
          } else {
            map.fitBounds(
              L.latLngBounds([pickupC.lat, pickupC.lon], [dropC.lat, dropC.lon]),
              { padding: [48, 48] }
            );
          }
          onStatsRef.current?.({ miles: Math.round(miles * 10) / 10, minutes, steps });
        } else if (phase === "to_pickup" || phase === "to_dropoff") {
          const from = phase === "to_pickup" ? driverC : pickupC;
          const to = phase === "to_pickup" ? pickupC : dropC;
          const route = await fetchRoute(from, to);
          if (cancelled) return;

          if (route && route.path.length > 1) {
            const line = drawPath(route.path, LINE, 5);
            routeBoundsRef.current = line.getBounds();
            map.fitBounds(line.getBounds(), { padding: [40, 40] });
            onStatsRef.current?.({
              miles: route.miles,
              minutes: route.minutes,
              steps: route.steps || [],
            });
          } else {
            L.polyline(
              [
                [from.lat, from.lon],
                [to.lat, to.lon],
              ],
              { color: LINE, weight: 4, opacity: 0.85, dashArray: "8 10" }
            ).addTo(layers);
            map.fitBounds(L.latLngBounds([from.lat, from.lon], [to.lat, to.lon]), {
              padding: [40, 40],
            });
            onStatsRef.current?.(null);
          }
        } else {
          map.fitBounds(
            L.latLngBounds([pickupC.lat, pickupC.lon], [dropC.lat, dropC.lon]),
            { padding: [48, 48] }
          );
          onStatsRef.current?.(null);
        }

        setTimeout(() => map.invalidateSize(), 150);
      } catch (e) {
        console.error("RouteMap", e);
        onStatsRef.current?.(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // GPS is NOT in this list — stops flicker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dropoff, phase]);

  // Move only the driver pin when GPS updates; follow if street zoom is on
  useEffect(() => {
    if (driverLat == null || driverLng == null) return;
    try {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driverLat, driverLng]);
      }
      if (followRef.current && mapRef.current) {
        mapRef.current.setView([driverLat, driverLng], 17, { animate: true });
      }
    } catch {}
  }, [driverLat, driverLng]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
        tileRef.current = null;
        driverMarkerRef.current = null;
      }
    };
  }, []);

  const zoomStreet = () => {
    const map = mapRef.current;
    if (!map) return;
    followRef.current = true;
    const lat = driverLat ?? pickupCRef.current?.lat ?? ST_PETE.lat;
    const lng = driverLng ?? pickupCRef.current?.lon ?? ST_PETE.lon;
    map.setView([lat, lng], 17, { animate: true });
  };

  const zoomFull = () => {
    const map = mapRef.current;
    if (!map) return;
    followRef.current = false;
    if (routeBoundsRef.current) {
      map.fitBounds(routeBoundsRef.current, { padding: [28, 28], animate: true });
    } else if (pickupCRef.current && dropCRef.current) {
      map.fitBounds(
        [
          [pickupCRef.current.lat, pickupCRef.current.lon],
          [dropCRef.current.lat, dropCRef.current.lon],
        ],
        { padding: [28, 28] }
      );
    }
  };

  const btn = {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "1px solid #E8D5A3",
    background: "rgba(253,248,240,0.96)",
    color: "#6B5B3E",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  };

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          background: "#d4e4f0",
          zIndex: 0,
          touchAction: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 10,
          bottom: 14,
          zIndex: 1100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button type="button" title="Street — follow the road" onClick={zoomStreet} style={btn}>
          +
        </button>
        <button type="button" title="Full route ahead" onClick={zoomFull} style={btn}>
          −
        </button>
      </div>
    </div>
  );
}
