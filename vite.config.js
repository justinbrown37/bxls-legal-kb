import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Allow importing legal_kb.json from the repo root (outside src/).
export default defineConfig({
  plugins: [react()],
});
