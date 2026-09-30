import type { NextConfig } from "next";

/**
 * Browser-level backstop for the privacy rule (CLAUDE.md): scripts on our
 * pages may only connect to our own origin. The one allowed request is the
 * solver binary (/solver/highs.wasm, see src/app/lib/solver-asset.ts); any
 * fetch/XHR/beacon/WebSocket to another origin is blocked by the browser.
 */
export const CONTENT_SECURITY_POLICY = "connect-src 'self'";

const nextConfig: NextConfig = {
  headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }],
      },
    ];
  },
};

export default nextConfig;
