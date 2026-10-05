# Batch 3-20 — 2.12.1

Tasks: MEM-2, NAV-2, MEM-3, MEM-5, MEM-4. MEM-1 and NAV-1 are done. No sibling edits. Two palette commands. No typing bench.

Measured on Test Lab, 2026-10-05. Undo of a string plus a child: first undo clears the child, second restores the string. A create-time write did not stick. Two diagram blocks, ages 296 and 4 days, have 0 children. No card is 6 to 8 days old.

MEM-4 live check uses a card made today, on the October 12th, 2026 page.

## MEM-2 Why

Popover on Label and Edit why. Fields: label and Why. Enter saves both. Shift+Enter adds a newline in Why. Esc cancels.

Save order, no props write: the connection string, then the first non-attribute child. An empty why creates nothing. Clearing an existing why deletes that child.

A pilcrow sits on the arrow at detail zoom. Hover shows the first 200 characters. chipText appends ` · because …`, clipped at 48. No why leaves the chip as it is.

Setting `why-prompt` defaults off. When on, a labelled connection opens the popover on Why.

## NAV-2 Contexts

On a block card, References opens an inline drawer, 240px, scroll. Page cards still open Roam mentions.

Rows group by year, newest first. Breadcrumb is page, then parent, clipped. Snippet is 200 characters. Cap 200, with a note for the rest. The first 25 rows are synchronous. Later rows arrive in chunks of 25. A filter box shows only past 20 rows.

Click opens the block in the main window. Shift-click opens the sidebar. No writes. The drawer hides in map zoom.

## MEM-3 Memory lane

More menu and Shift+T. The bar is 36px. State stays in memory.

The thumb runs from the earliest known create time to now. A missing time stays visible. Later items fade to opacity .12. Later connections hide. Items from the past week of the thumb get an outline.

Play steps one month every 700ms, so two years finish under 20s. Reduced motion jumps to the end. Snapshot ticks move cards in the view only. Esc restores the live layout. Do not call the restore writer. Day ticks wait for NAV-3.

## MEM-5 Suggest

The links button keeps L as a cycle. Its menu adds Suggest: Off, Shared refs, or Shared and unlinked.

Lines are dotted strokes, no fill, at most 60. Past 300 cards, say “Too many cards to suggest” unless the selection is smaller.

Reasons: `Both reference [[Zone 2]]`, or `Mentions 'Sanitation' without a link`. Skip short titles, daily-page titles, and words already inside brackets.

Connect calls addEdge with the shared page as the label. Link text is one string write. Dismiss lasts for the session. Off removes the lines.

## MEM-4 Resurface

Decorate `button.rm-xparser-default-plexus-resurface`. Unload removes the panel and leaves the button.

Tabs use setting `resurface-intervals`, default `7,30,90,365`. Show week, month, 3 months, and year. Hide empty tabs. Six items each. A hit is within one day of the page date minus the interval.

The page date is the `h1.rm-title-display` text, via pageTitleToDate. Other pages show one empty line. “Resurface here” is on the Commands sheet only and inserts the macro. Open on board pulses the card.

## Files

Models: `why.js`, `contexts.js`, `timeline.js`, `resurface.js`, `suggest.js`, each with a test. Views and css for the popover, drawer, lane, lines, and panel. Wire `board.js`, `session.js`, `relchips.js`, `menu-model.js`, `shortcuts.js`, `settings.js`, `feature.js`, `board-view.js`. Update the Commands row list.

## Acceptance

MEM-2: label on the connection string, why on the first child, pilcrow, chip contains the because line, two undos, empty why adds no child.

NAV-2: three rows by year, shift-click opens the sidebar, 250 refs show the cap note, first 25 paint, no write.

MEM-3: start thumb shows the earlier card, the end shows both, play stops, snapshot preview leaves edit times alone.

MEM-5: two dotted lines, one Zone 2 connection, one wrapped string, Off clears the lines. 300 cards stay under 150ms in the unit test.

MEM-4: the October 12th, 2026 page shows the new card under 1 week. Open pulses it. Unload leaves the plain button.

