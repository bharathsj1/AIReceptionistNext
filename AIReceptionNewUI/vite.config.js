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
    }
  };
});
