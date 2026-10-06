import assert from "node:assert/strict";
import test from "node:test";

import { dailyPageTitle } from "../src/model/schema.js";
import {
  DAILY_TITLE_PATTERN,
  TIMELINE_DAY_CAP,
  dateSource,
  firstMention,
  groupTimeline,
  lastMention,
  previewLayout,
  timelineQuery,
} from "../src/model/timeline.js";
import { pageTitleToDate } from "../src/model/resurface.js";
import { mountTimeline } from "../src/view/timeline.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ROWS = [
  { cardUid: "cardA", pageTitle: "October 5th, 2026", pageUid: "10-05-2026", time: 1 },
  { cardUid: "cardA", pageTitle: "October 5th, 2026", pageUid: "10-05-2026", time: 2 },
  { cardUid: "cardB", pageTitle: "October 5th, 2026", pageUid: "10-05-2026", time: 3 },
  { cardUid: "cardA", pageTitle: "October 1st, 2026", pageUid: "10-01-2026", time: 4 },
  { cardUid: "cardC", pageTitle: "September 30th, 2025", pageUid: "09-30-2025", time: 5 },
  { cardUid: "cardA", pageTitle: "Projects", pageUid: "proj", time: 6 },
  { cardUid: "cardA", pageTitle: "February 31st, 2026", pageUid: "bad", time: 7 },
  { cardUid: "cardA", pageTitle: "October 5, 2026", pageUid: "bare", time: 8 },
];

function daysOf(groups) {
  return groups.flatMap((year) => year.days);
}

test("NAV-3: one batched query returns daily-page referrers for every target uid", () => {
  const { query, args } = timelineQuery(["cardA", "cardA", "", null, "board"]);
  assert.equal(query.split(":find").length, 2);
  assert.match(query, /\[:find \?card \?ref \?title \?page \?time/);
  assert.match(query, /:in \$ \[\?card \.\.\.\] \?pat/);
  assert.match(query, /\[\?b :block\/refs \?c\]/);
  assert.match(query, /\[\(get-else \$ \?b :create\/time 0\) \?time\]/);
  assert.equal(args.length, 2);
  assert.deepEqual(args[0], ["cardA", "board"]);
  assert.equal(args[1], DAILY_TITLE_PATTERN);
  assert.match(args[1], /October/);
  assert.deepEqual(timelineQuery(null).args[0], []);
});

test("NAV-3: three daily pages group newest first, with ref counts, and drop non-dates", () => {
  const groups = groupTimeline(ROWS);
  assert.deepEqual(groups.map((year) => year.year), [2026, 2025]);
  const days = daysOf(groups);
  assert.deepEqual(days.map((day) => day.title), [
    "October 5th, 2026",
    "October 1st, 2026",
    "September 30th, 2025",
  ]);
  assert.deepEqual(days.map((day) => day.count), [3, 1, 1]);
  assert.deepEqual(days.map((day) => day.pageUid), ["10-05-2026", "10-01-2026", "09-30-2025"]);
  assert.deepEqual([...days[0].cardUids].sort(), ["cardA", "cardB"]);
  assert.equal(days[0].date, pageTitleToDate("October 5th, 2026"));
  assert.equal(groupTimeline([
    ["cardA", "ref1", "October 5th, 2026", "10-05-2026", 9],
  ])[0].days[0].count, 1);
});

test("NAV-3: the list keeps the 365 newest days and mentions do not", () => {
  const rows = [];
  for (let i = 0; i < 400; i += 1) {
    const time = new Date(2024, 0, 1 + i).getTime();
    rows.push({ cardUid: "c", pageTitle: dailyPageTitle(time), pageUid: `p${i}`, time });
  }
  const days = daysOf(groupTimeline(rows));
  assert.equal(TIMELINE_DAY_CAP, 365);
  assert.equal(days.length, 365);
  assert.equal(days[0].title, dailyPageTitle(new Date(2024, 0, 400).getTime()));
  assert.equal(days.some((day) => day.title === dailyPageTitle(new Date(2024, 0, 1).getTime())), false);
  assert.equal(days[0].date >= days[364].date, true);
  assert.equal(firstMention(rows).get("c"), pageTitleToDate(dailyPageTitle(new Date(2024, 0, 1).getTime())));
});

test("NAV-3: date source is the attribute, the first mention, or the last mention", () => {
  assert.equal(dateSource({ uid: "cardA", date: 42, title: "October 5th, 2026" }, ROWS, "attribute"), 42);
  assert.equal(dateSource({ uid: "cardA", title: "October 3rd, 2026" }, ROWS, "attribute"), pageTitleToDate("October 3rd, 2026"));
  assert.equal(
    dateSource({ uid: "notes", string: "Due:: [[October 5th, 2026]]" }, ROWS, "attribute"),
    pageTitleToDate("October 5th, 2026"),
  );
  assert.equal(dateSource({ uid: "notes", string: "Date:: 2026-10-05" }, ROWS, "attribute"), new Date(2026, 9, 5).getTime());
  assert.equal(dateSource({ uid: "cardA", title: "Notes" }, ROWS, "first"), pageTitleToDate("October 1st, 2026"));
  assert.equal(dateSource({ uid: "cardA", title: "Notes" }, ROWS, "last"), pageTitleToDate("October 5th, 2026"));
  assert.equal(dateSource({ uid: "cardA" }, ROWS, "first mention"), pageTitleToDate("October 1st, 2026"));
  assert.equal(dateSource({ uid: "missing" }, ROWS, "last mention"), null);
  assert.equal(dateSource({ uid: "cardA" }, ROWS, "create"), null);
  const cards = [{ uid: "cardA" }, { uid: "cardC" }, { uid: "cardB" }];
  const ordered = cards.slice().sort((a, b) => dateSource(a, ROWS, "first") - dateSource(b, ROWS, "first"));
  assert.deepEqual(ordered.map((card) => card.uid), ["cardC", "cardA", "cardB"]);
  assert.equal(lastMention(ROWS).get("cardB"), pageTitleToDate("October 5th, 2026"));
  assert.equal(previewLayout([]).writes, 0);
});

test("NAV-3: the timeline opens a day, shows its cards, and collapses a year from one listener", () => {
  const stub = createDomStub();
  const parent = stub.document.createElement("div");
  const opened = [];
  const shown = [];
  const writes = [];
  const view = mountTimeline(parent, {
    doc: stub.document,
    rows: ROWS,
    onOpenDay(pageUid) { opened.push(pageUid); },
    onShowOnBoard(cardUids) { shown.push([...cardUids]); writes.push("nope"); },
  });
  assert.equal(view.el.listeners.get("click").size, 1);
  assert.equal(view.el.querySelector(".pxd-timeline__day").listeners.get("click"), undefined);
  const days = view.el.querySelectorAll(".pxd-timeline__day");
  assert.equal(days.length, 3);
  assert.equal(days[0].querySelector(".pxd-timeline__open").textContent, "October 5th, 2026");
  assert.equal(days[0].querySelector(".pxd-timeline__count").textContent, "3");
  days[0].querySelector(".pxd-timeline__show").click();
  assert.deepEqual(shown, [["cardA", "cardB"]]);
  assert.deepEqual(opened, []);
  days[1].querySelector(".pxd-timeline__open").click();
  assert.deepEqual(opened, ["10-01-2026"]);
  const year = view.el.querySelector(".pxd-timeline__year");
  const bucket = year.parentElement.querySelector(".pxd-timeline__days");
  assert.equal(year.getAttribute("aria-expanded"), "true");
  year.click();
  assert.equal(year.getAttribute("aria-expanded"), "false");
  assert.equal(bucket.hasAttribute("hidden"), true);
  view.update(ROWS);
  assert.equal(view.el.listeners.get("click").size, 1);
  assert.equal(view.el.querySelector(".pxd-timeline__year").getAttribute("aria-expanded"), "false");
  assert.equal(view.el.querySelectorAll(".pxd-timeline__day button").length > 0, true);
  for (const button of view.el.querySelectorAll("button")) {
    assert.equal(button.listeners.get("click"), undefined);
  }
  view.update([]);
  assert.equal(view.el.querySelector(".pxd-timeline__empty").textContent, "No daily notes mention this board.");
  assert.deepEqual(writes, ["nope"]);
  view.dispose();
  view.dispose();
  assert.equal(view.el.listeners.get("click").size, 0);
  assert.equal(parent.querySelector(".pxd-timeline"), null);
  days[0].querySelector(".pxd-timeline__open").click();
  assert.deepEqual(opened, ["10-01-2026"]);
});
