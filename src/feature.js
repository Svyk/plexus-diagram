import { SETTING_IDS } from "./settings.js";

export function greeting(extensionAPI, now = new Date()) {
  const suffix = extensionAPI.settings.get(SETTING_IDS.includeTimestamp)
    ? ` at ${now.toLocaleTimeString()}`
    : "";
  return `Hello from Example Extension${suffix}!`;
}

export async function installExampleFeature({ extensionAPI, lifecycle }) {
  await lifecycle.command(extensionAPI.ui.commandPalette, {
    label: "Example Extension: Say hello",
    callback: () => console.info(greeting(extensionAPI)),
  });
}

