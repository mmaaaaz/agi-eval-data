import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  // Vite 6 rejects unknown Host headers (403 "Blocked request") by default; the
  // local dev server is reached through a cloudflared quick tunnel, whose
  // random *.trycloudflare.com hostname cannot be listed ahead of time.
  server: {
    allowedHosts: [".trycloudflare.com"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@site/shell": path.resolve(__dirname, "../../packages/site/src/shell.tsx"),
      "@site/data": path.resolve(__dirname, "../../packages/site/src/data.ts"),
      "@site/format": path.resolve(__dirname, "../../packages/site/src/format.ts"),
      "@site/questions": path.resolve(__dirname, "../../packages/site/src/questions.ts"),
      "@site/authoring": path.resolve(__dirname, "../../packages/site/src/authoring.tsx"),
      "@site/review": path.resolve(__dirname, "../../packages/site/src/review.tsx"),
      "@site/vqaReview": path.resolve(__dirname, "../../packages/site/src/vqaReview.tsx"),
      "@site/triage": path.resolve(__dirname, "../../packages/site/src/triage.tsx"),
      "@site/select": path.resolve(__dirname, "../../packages/site/src/SelectGrid.tsx"),
      "@site/nominated": path.resolve(__dirname, "../../packages/site/src/NominationBoard.tsx"),
      "@site/actor": path.resolve(__dirname, "../../packages/site/src/ActorBar.tsx"),
      "@site/livesync": path.resolve(__dirname, "../../packages/site/src/useLiveSync.ts"),
      "@site/anchor": path.resolve(__dirname, "../../packages/site/src/AnchorBox.tsx"),
      "@site/grading": path.resolve(__dirname, "../../packages/site/src/grading.tsx"),
      "@site/syncchip": path.resolve(__dirname, "../../packages/site/src/SyncChip.tsx"),
      "@site/thumb": path.resolve(__dirname, "../../packages/site/src/ThumbImage.tsx"),
      "@site/virtual": path.resolve(__dirname, "../../packages/site/src/VirtualGallery.tsx"),
      "@site/section": path.resolve(__dirname, "../../packages/site/src/Section.tsx"),
      "@site/lightbox": path.resolve(__dirname, "../../packages/site/src/Lightbox.tsx"),
      "@site/settings": path.resolve(__dirname, "../../packages/site/src/settings.ts"),
      "@site/ui": path.resolve(__dirname, "../../packages/site/src/ui.tsx"),
      "@site/dataContext": path.resolve(__dirname, "../../packages/site/src/dataContext.tsx"),
    },
  },
});
