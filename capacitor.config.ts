import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flourishbx.order",
  appName: "Flourish BX",
  webDir: "dist",
  ios: { contentInset: "always" },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#FBF7FC" },
  },
};

export default config;
