import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flourishbx.order",
  appName: "Flourish BX",
  webDir: "dist",
  /* Paper, not the default black. Without this there is a black flash between
     the native launch image going away and the web view painting its first
     frame — which read as "the splash is broken" even when it was not. */
  backgroundColor: "#FBF7FC",
  ios: { contentInset: "always", backgroundColor: "#FBF7FC" },
  android: { backgroundColor: "#FBF7FC" },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#FBF7FC" },
  },
};

export default config;
