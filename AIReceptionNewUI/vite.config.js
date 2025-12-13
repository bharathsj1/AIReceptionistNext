import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for a simple React SPA
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const functionHost = env.VITE_FUNCTION_HOST || "http://localhost:7071";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: 'http://localhost:7071',
          changeOrigin: true,
          secure: false
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
