export const SETTING_IDS = Object.freeze({
  includeTimestamp: "include-timestamp",
});

export async function initializeSettings(extensionAPI) {
  if (
    extensionAPI.settings.canSet !== false
    && extensionAPI.settings.get(SETTING_IDS.includeTimestamp) == null
  ) {
    await extensionAPI.settings.set(SETTING_IDS.includeTimestamp, true);
  }
}

export function createSettingsPanel() {
  return {
    tabTitle: "Example Extension",
    settings: [
      {
        id: SETTING_IDS.includeTimestamp,
        name: "Include timestamp",
        description: "Include the current time in the example command's console greeting.",
        action: {
          type: "switch",
          onChange: (event) => {
            console.info("[example-extension] Include timestamp:", event.target.checked);
          },
        },
      },
    ],
  };
}

