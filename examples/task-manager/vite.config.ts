import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@zeroback/client": path.resolve(__dirname, "node_modules/@zeroback/client"),
      "@zeroback/react": path.resolve(__dirname, "node_modules/@zeroback/react"),
      "@zeroback/values": path.resolve(__dirname, "node_modules/@zeroback/values"),
    },
  },
});
