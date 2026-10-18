import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // models.json lives outside this app (scripts/harness/), allow the dev server to read it.
  server: { fs: { allow: ["..", "../.."] } },
  build: { outDir: "dist" },
});
