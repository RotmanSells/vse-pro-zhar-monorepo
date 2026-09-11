const easProjectId = globalThis.process?.env?.["EXPO_PUBLIC_EAS_PROJECT_ID"]?.trim();
const updatesUrl = easProjectId === undefined || easProjectId === "" ? undefined : `https://u.expo.dev/${easProjectId}`;

export default {
  name: "Все Про Жар",
  slug: "vse-pro-zhar",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "vseprozhar",
  platforms: ["ios", "android", "web"],
  userInterfaceStyle: "automatic",
  web: { bundler: "metro", output: "static" },
  experiments: { typedRoutes: true },
  runtimeVersion: { policy: "appVersion" },
  updates: {
    checkAutomatically: "ON_LOAD",
    ...(updatesUrl === undefined ? {} : { url: updatesUrl })
  },
  extra: {
    ...(easProjectId === undefined || easProjectId === "" ? {} : { eas: { projectId: easProjectId } })
  },
  plugins: ["expo-router", "expo-notifications"]
};
