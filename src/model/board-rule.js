// Datalog rule `(board-member ?board ?b)`: ?b is a card of ?board.
// Roam's data.q takes a rules string as the `%` input (checked live 2026-10-11), but there is no call that
// registers a rule for other callers, and Roam's own docs say custom rules are not supported. So the rule ships as a
// string on window.__plexusDiagram.rules and the caller passes it. A recursive rule timed out on a 50-card board,
// so the rule is two flat branches and uses :block/parents for cards under a section.

export const BOARD_MEMBER_NAME = "board-member";

const CONTAINERS = ["edges", "snapshots", "regions", "trails", "picture"].map((t) => `"${t}"`).join(" ");

// Branch 1: a direct child of the board that is not a container block (Connections, snapshots, regions, trails).
// Branch 2: a child of a section that sits anywhere under the board (nested sections included).
export const BOARD_MEMBER_RULE = [
  "[",
  `[(${BOARD_MEMBER_NAME} ?board ?b)`,
  " [?board :block/children ?b]",
  " (not-join [?b] [?b :block/props ?pr] [(get ?pr :plexus) ?x] [(get ?x :type) ?t]",
  `  [(contains? #{${CONTAINERS}} ?t)])]`,
  `[(${BOARD_MEMBER_NAME} ?board ?b)`,
  " [?b :block/parents ?board] [?pa :block/children ?b] [?pa :block/parents ?board]",
  " [?pa :block/props ?pr] [(get ?pr :plexus) ?x] [(get ?x :type) ?t] [(= ?t \"section\")]]",
  "]",
].join(" ");

export function createBoardRules(win = globalThis) {
  return {
    boardMember: BOARD_MEMBER_RULE,
    boardMemberName: BOARD_MEMBER_NAME,
    // q("[:find ?s :in $ % :where [?board :block/uid \"X\"] (board-member ?board ?b) [?b :block/string ?s]]")
    q(query, ...inputs) {
      const api = win?.roamAlphaAPI?.data;
      if (typeof api?.q !== "function") throw new Error("roamAlphaAPI.data.q is not available");
      return api.q(query, BOARD_MEMBER_RULE, ...inputs);
    },
  };
}

// Put the rules on the public api object; the returned function takes them off again.
export function installBoardRules(api, win = globalThis) {
  if (!api || typeof api !== "object") return () => {};
  const rules = createBoardRules(win);
  api.rules = rules;
  return () => { if (api.rules === rules) delete api.rules; };
}
