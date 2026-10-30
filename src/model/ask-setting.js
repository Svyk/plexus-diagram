// The "Ask AI model" setting, kept outside the lazy ask module so the board can hand it over at start.
let askModelSetting = () => "auto";
// The board hands over the "Ask AI model" setting; a conversation reads it when it starts.
export function setAskSettings({ model = null } = {}) {
  askModelSetting = typeof model === "function" ? model : () => "auto";
}
export function getAskModelSetting() {
  return askModelSetting();
}
