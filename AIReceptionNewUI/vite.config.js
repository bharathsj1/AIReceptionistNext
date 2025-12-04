import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for a simple React SPA
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const functionHost = env.VITE_FUNCTION_HOST || "https://aireceptionist-func.azurewebsites.net";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: functionHost,
          changeOrigin: true,
          secure: false
        }
      }
    }
  };
});
