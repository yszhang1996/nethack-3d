import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nethack3d.app",
  appName: "NetHack 3D",
  webDir: "dist",
  bundledWebRuntime: false,
  appVersion: "0.8.5",
  plugins: {
    SystemBars: {
      insetsHandling: "css",
    },
  },
};

export default config;
