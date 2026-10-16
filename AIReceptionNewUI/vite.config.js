import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for a simple React SPA
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUpstream = env.BACKEND_UPSTREAM || "http://127.0.0.1:7071";
  const meetingsUpstream = env.MEETINGS_UPSTREAM || "http://127.0.0.1:7072";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api/meetings": {
          target: meetingsUpstream,
          changeOrigin: true,
        },
        "/api": {
          target: backendUpstream,
          changeOrigin: true
        }
      }
    },
    build: {
      // Split heavy libraries into their own chunks to keep the app bundle smaller.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("react")) return "react-vendor";
              if (id.includes("gsap")) return "gsap";
              if (id.includes("stripe")) return "stripe";
              if (id.includes("lenis")) return "lenis";
              if (id.includes("ultravox-client")) return "ultravox";
            }
          }
        }
      },
      // Slightly raised to reduce noise after vendor splitting while keeping a guardrail.
      chunkSizeWarningLimit: 800
    }
  };
});
