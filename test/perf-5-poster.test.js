// PERF-5 poster model. Titles come from the string. A count is shown only when one was already carried.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { coverModel, embedPoster, embedSplit, heavyEmbed, heavyRefUid, posterModel, posterThumb, readerRule } from "../src/model/pdf.js";

test("heavyEmbed names a pdf, video, iframe, or tweet and ignores highlights and plain text", () => {
  assert.equal(heavyEmbed("{{[[pdf]]: https://example.test/paper.pdf}}").kind, "pdf");
  assert.equal(heavyEmbed("{{[[pdf]]: https://example.test/paper.pdf}}").title, "paper");
  assert.equal(heavyEmbed("see {{[[video]]: https://cdn.example/clip.mp4}} now").kind, "video");
  assert.equal(heavyEmbed("{{[[video]]: https://cdn.example/clip.mp4}}").title, "clip");
  assert.equal(heavyEmbed("{{[[youtube]]: dQw4w9WgXcQ}}").kind, "iframe");
  assert.equal(heavyEmbed("{{[[youtube]]: dQw4w9WgXcQ}}").title, "YouTube");
  assert.equal(heavyEmbed("{{iframe: https://www.example.com/embed}}").title, "example.com");
  assert.equal(heavyEmbed("{{tweet: https://twitter.com/jack/status/20}}").kind, "tweet");
  assert.equal(heavyEmbed("{{tweet: https://twitter.com/jack/status/20}}").title, "@jack");
  assert.equal(heavyEmbed("{{[[twitter]]: https://x.com/status/20}}").title, "Tweet");
  assert.deepEqual(heavyEmbed("<iframe src=\"https://example.com\"></iframe>"), { kind: "iframe", url: "", title: "Embed" });
  assert.equal(heavyEmbed("<video src=\"x\"></video>").kind, "video");
  assert.equal(heavyEmbed("{{pdf-highlight: quoted passage}}"), null);
  assert.equal(heavyEmbed("{{[[pdf-highlight]]: ((abc))}}"), null);
  assert.equal(heavyEmbed("a plain note"), null);
  assert.equal(heavyEmbed("https://example.com/a.mp4"), null);
  assert.equal(heavyEmbed("{{[[roam/render]]: ((abc))}}"), null);
});

test("a poster keeps a carried highlight count and drops a missing one", () => {
  const carried = posterModel({ kind: "pdf", title: "Paper", url: "https://example.test/paper.pdf", count: 2 });
  assert.equal(carried.title, "Paper");
  assert.equal(carried.label, "2 highlights");
  assert.equal(carried.count, 2);
  const one = posterModel({ kind: "pdf", url: "https://example.test/paper.pdf", count: 1 });
  assert.equal(one.label, "1 highlight");
  const bare = posterModel({ kind: "pdf", url: "https://example.test/paper.pdf" });
  assert.equal(bare.title, "paper");
  assert.equal("count" in bare, false);
  assert.equal("label" in bare, false);
  assert.deepEqual(coverModel({ title: "Paper", count: 2 }), { title: "Paper", count: 2, label: "2 highlights" });
});

test("a thumb is an in-memory image, never an http url", () => {
  const data = "data:image/png;base64,aaaa";
  assert.equal(posterThumb({ thumb: data }), data);
  assert.equal(posterThumb({ thumb: "https://example.test/a.png" }), "");
  assert.equal(posterThumb({ url: data }), data);
  assert.equal(posterThumb({
    thumb: { complete: true, naturalWidth: 12, currentSrc: "blob:local/1" },
  }), "blob:local/1");
  assert.equal(posterThumb({
    thumb: { complete: false, naturalWidth: 12, currentSrc: data },
  }), "");
  assert.equal(posterThumb({ thumb: "data:image/png;base64,aa(a)" }), "");
});

test("a ref is one hop, and a mixed string keeps the leftover words", () => {
  assert.equal(heavyRefUid("((pdfblock1))"), "pdfblock1");
  assert.equal(heavyRefUid("{{[[embed]]: ((videouid1))}}"), "videouid1");
  assert.equal(heavyRefUid("see ((pdfblock1))"), "");
  const read = (uid) => (uid === "pdfblock1" ? "{{[[pdf]]: https://example.test/paper.pdf}}" : "");
  const cover = () => ({ title: "Paper", count: 3 });
  const one = embedPoster("((pdfblock1))", { read, cover, uid: "card1" });
  assert.equal(one.kind, "pdf");
  assert.equal(one.uid, "pdfblock1");
  assert.equal(one.title, "Paper");
  assert.equal(one.label, "3 highlights");
  const video = embedPoster("{{[[video]]: https://cdn.example/clip.mp4}}", { read, cover, uid: "videocard1" });
  assert.equal(video.kind, "video");
  assert.equal(video.title, "clip");
  assert.equal("label" in video, false);
  assert.equal(embedPoster("((missing01))", { read, cover }), null);
  const mixed = embedSplit("Watch {{[[youtube]]: abc}} later", { uid: "note1" });
  assert.equal(mixed.rest, "Watch later");
  assert.equal(mixed.posters.length, 1);
  assert.equal(mixed.posters[0].title, "YouTube");
  assert.deepEqual(embedSplit("((pdfblock1))", { read, cover }), { posters: [one], rest: "" });
});

test("readerRule still keeps a single open uid", () => {
  assert.deepEqual(readerRule(null, "video1"), { open: "video1", close: null });
  assert.deepEqual(readerRule("video1", "video1"), { open: "video1", close: null });
  assert.deepEqual(readerRule("video1", "frame1"), { open: "frame1", close: "video1" });
  assert.deepEqual(readerRule("video1", ""), { open: "video1", close: null });
});

test("card css styles the embed poster", () => {
  const css = readFileSync(new URL("../src/css/cards.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-embed-poster/);
  assert.match(css, /\.pxd-embed-poster__title/);
  assert.match(css, /\.pxd-embed-open/);
});
