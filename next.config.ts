import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { API_URL, IPFS_GATEWAY, RPC_URL, X402_URL } from "./lib/stellar/config";
import { buildCsp } from "./lib/security/csp";

/**
 * Deterministic build ID generation.
 * Uses commit SHA (or NEXT_PUBLIC_BUILD_ID/BUILD_ID env) with safe local fallback.
 */
function resolveBuildId(): string {
  const explicit = process.env.NEXT_PUBLIC_BUILD_ID?.trim() || process.env.BUILD_ID?.trim();
  if (explicit && /^[A-Za-z0-9_-]+$/.test(explicit)) return explicit;
  const sha = (
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.HEAD ||
    ""
  ).trim();
  if (sha && /^[A-Za-z0-9_-]+$/.test(sha)) return sha.slice(0, 16);
  try {
    const gitSha = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (gitSha && /^[0-9a-f]{7,40}$/i.test(gitSha)) return gitSha;
  } catch {
    // Git unavailable; fall through
  }
  return "deterministic-static-build-id";
}

const DETERMINISTIC_BUILD_ID = resolveBuildId();

const isDev = process.env.NODE_ENV !== "production";
const reportUri = process.env.NEXT_PUBLIC_CSP_REPORT_URL?.trim() || "";
const enforce = process.env.NEXT_PUBLIC_CSP_ENFORCE === "1" || process.env.NEXT_PUBLIC_CSP_ENFORCE === "true";

const csp = buildCsp({
  apiUrl: API_URL,
  rpcUrl: RPC_URL,
  ipfsGateway: IPFS_GATEWAY,
  x402Url: X402_URL,
  reportUri,
  dev: isDev,
});

// Trusted Types is report-only until the wallet kit and Next bootstrap are audited.
const cspValue = enforce
  ? csp
  : `${csp}; require-trusted-types-for 'script'; trusted-types default nextjs#bundler`;

const securityHeaders = [
  { key: enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: cspValue },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // usb/hid stay available to self so Ledger and Trezor can work.
    value: "camera=(), microphone=(), geolocation=(), payment=(), fullscreen=(self), usb=(self), hid=(self)",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  /**
   * Static export mode for reproducible content-addressed static builds.
   */
  output: "export",

  /**
   * Next.js 16 typed routes: validates internal Link/router targets at compile time.
   */
  typedRoutes: true,

  /**
   * Enforce deterministic build id exposed to application and service worker.
   */
  generateBuildId: async () => DETERMINISTIC_BUILD_ID,

  env: {
    NEXT_PUBLIC_BUILD_ID: DETERMINISTIC_BUILD_ID,
  },

  /**
   * React Compiler (issue #152).
   *
   * Enabled incrementally: it runs on every file but annotationOnly mode
   * lets you opt specific directories out by adding a `// @no-memo` comment
   * at the top of a file, or by listing them in `ignoredDirs` below.
   *
   * Directories known to have Rules-of-React violations (Math.random in
   * render, setInterval in body) are excluded until they are cleaned up.
   * Remove an entry here once the violations in that directory are fixed and
   * the compiler's lint rule passes with no new errors.
   *
   * To verify the compiler is running: `NEXT_COMPILER_VERBOSE=1 next build`
   * will log each component the compiler processes.
   */
  experimental: {
    reactCompiler: {
      compilationMode: "infer",
      // Opt out problematic directories incrementally.
      // Each entry is a path prefix relative to the project root.
      sources: (filename: string) => {
        const excluded = [
          // app/page.tsx uses Math.random() + setInterval in render-adjacent code.
          "app/page.tsx",
          // copy-trade reads refs during render for slider geometry.
          "app/copy-trade/",
        ];
        return !excluded.some((p) => filename.includes(p));
      },
    },
  },

  /**
   * Headers are defined here for custom static hosts (or local dev server).
   */
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
