import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: only our own scripts/API; images may come from https (company logos, QR codes).
const csp = (frameAncestors: string) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors ${frameAncestors}`,
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // Browser talks to Next on one origin; /api/* is forwarded to FastAPI so the
  // httpOnly session cookie stays first-party.
  async rewrites() {
    // On Vercel, vercel.json routes /api/* to the backend service before Next.js sees it.
    if (process.env.VERCEL) return [];
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async headers() {
    return [
      // the CRM itself can never be framed (clickjacking)
      { source: "/((?!f/|api/).*)", headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: csp("'none'") }] },
      // hosted public forms are meant to be embedded on the company website
      { source: "/f/:path*", headers: [...common, { key: "Content-Security-Policy", value: csp("*") }] },
    ];
  },
  experimental: { proxyClientMaxBodySize: "30mb" },
  poweredByHeader: false,
};

export default nextConfig;
