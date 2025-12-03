import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for a simple React SPA
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7071",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
