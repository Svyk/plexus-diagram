# Plexus Diagram 2.0 — module contracts

Companion to `docs/api-plexus-1.0.md`. The running package is 2.0.0.

| Already in the 1.0 file | Stays there |
|---|---|
| schema, board, geometry, links, layout, clipboard, export | signatures |
| host/roam, host/migrate, session, session-clip | signatures |
| view entry, cards, edges, interactions, chrome, panel, menu, menu-model, quicklook, present, clipboard-io | signatures |

## Changes since the 1.0 contract

| Module | What a caller should use now |
|---|---|
| schema.js | `normalizeItemLayout` does not require `fontSize` to be one of `FONT_SIZES`. Cards and text take an integer 10–48. Sections use `titleSize` 10–48. |
| schema.js | `BOARD_PATTERNS` is `dots`, `lines`, `cross`, `grid`, `plain`. The Depot `grid` select is only `dots`, `lines`, `grid`, `plain`. `cross` is a per-board `bg`. |
| schema.js | `color` is a palette name or lowercase `#rrggbb` via `styleColor`. `hexColor` rejects shorthand, alpha, and named CSS colors. |
| session.js | `BULK_CARD_CAP` is 45. `capBulk(list, emit)` returns the list, or the first 45 and a toast. |
| session.js | `setLinkMode(mode)` accepts `off`, `attributes`, `all`. Any other value returns without a change. |
| session-clip.js | `expandOutline(cardUid, options)` default `max` is 24, not 40. An omitted `depth` is 3. |
| board-view.js | `setSettings` calls `session.setLinkMode` only when `graph-links` actually changes. |
| settings.js | The panel is grouped. Reset calls `resetPlexusSettings`. |
| feature.js | `PACKAGE_VERSION` is `package.json`. The badge uses it first, so a live inject that passes `"live"` still shows 2.0.0. |

| Export | Contract |
|---|---|
| `hexColor(v)` | lowercase `#rrggbb`, or `undefined` |
| `styleColor(v)` | a `PALETTE` name, or `hexColor` |
| `boardColor(v)` | a `BOARD_TONES` name, or `hexColor` |
| `cssColor(value, role="line")` | a palette name becomes `var(--pxd-<name>-line\|text\|fill)`; otherwise hex or `undefined` |
| `shadeHex(hex, amount)` | amount below 0 darkens, above 0 lightens; lowercase hex or `undefined` |
| `normalizeSectionDefaults(raw)` | `{titleSize?, titleColor?, titleFill?, areaFill?, border?}`. `titleSize` 18 is omitted |
| `cardLook(kind, stored)` | a stored `block` or `card` wins. A note with no look is `block`. Other kinds are `card` |
| `lookForNewString(string, preferred)` | notes only: `card` or `block`. Other kinds return `undefined` |
| `boardString(title)` | the diagram block string for that title |
| `setBoardTitle(s, title)` | rewrites the leading diagram token. No token returns `boardString(title)` |
| `isUntitledBoard(title)` | true for a missing title or `Untitled board` |

| `normalizeItemLayout` field | Rule |
|---|---|
| `type` | one of `ITEM_TYPES`, default `card` |
| `x y w h` | finite numbers, otherwise `undefined` |
| `color` | `styleColor` |
| `collapsed` | only a real boolean is kept |
| `pinned` | boolean, true only when stored true |
| `fit` | `false` or `undefined` |
| `fontSize` | integer 10–48 on cards and text. `undefined` on sections |
| `titleSize` | integer 10–48 on sections only |
| `look` | cards `block\|card`, text `section-note\|sticky`, sections `lane` |
| `axis` | lanes only. `vertical`, otherwise `horizontal` |
| `shape` | text only, and only a member of `SHAPES` |
| style keys | cards and text: `textColor`, `align`, `fill`, `border`. Sections: `titleColor`, `titleFill`, `areaFill`, `border` |

| `serializeItemLayout` rule | Detail |
|---|---|
| card `fontSize` 14 | omitted |
| section `titleSize` 18 | omitted |
| text `fontSize` | every integer 10–48 is kept, including 24 |
| `pinned` | written only when true |
| `fit: false` | written only on sections |
| lane `axis` | always written. Missing means `horizontal` |
| `bg` | must be in `BOARD_PATTERNS` |
| `bgColor` | `boardColor` |

| Constant | Value |
|---|---|
| `CARD_LOOKS` | `block`, `card` |
| `TEXT_LOOKS` | `section-note`, `sticky` |
| `SECTION_LOOKS` | `lane` |
| `LANE_AXES` | `horizontal`, `vertical` |
| `STICKY_SIZE` | `{w:200, h:200}`, color `yellow` |
| `LANE_SIZE` | horizontal `{w:960,h:180}`, vertical `{w:240,h:640}` |
| `CARD_FONT_MIN` / `MAX` / `DEFAULT` | 10 / 48 / 14 |
| `SECTION_TITLE_MIN` / `MAX` / `DEFAULT` | 10 / 48 / 18 |
| `ALIGNS` | `left`, `center`, `right`, `justify` |
| `EDGE_WEIGHTS` | 1, 2, 3, 4 |
| `DASHES` | `solid`, `dashed`, `animated` |
| `NATIVE_SWATCHES` | 13 hex strings, the native Roam row |
| `ITEM_STYLE_KEYS` | `fontSize`, `textColor`, `align`, `fill`, `border`, `shape` |
| `SECTION_STYLE_KEYS` | `titleSize`, `titleColor`, `titleFill`, `areaFill`, `border` |

## src/lifecycle.js

| Export | Contract |
|---|---|
| `createLifecycle()` | `{ disposed, add, command, event, interval, timeout, observer, node, pullWatch, settingsPanel, dispose }` |
| `add(disposer)` | registers a function. After dispose, a late add runs at once |
| `command(api, config)` | `addCommand`, then remove by `{label}` |
| `event` / `interval` / `timeout` / `observer` / `node` | pair each registration with its remover |
| `pullWatch(dataApi, pattern, entity, callback)` | `addPullWatch` paired with `removePullWatch` |
| `settingsPanel(extensionAPI, config)` | `settings.panel.create` only. Roam drops the panel on unload |
| `dispose()` | runs removers in reverse. Failures throw `AggregateError` |

## src/discovery.js

| Export | Contract |
|---|---|
| `DIAGRAM_MARKER` | `/\{\{\s*(\[\[)?diagram/i` |
| `MAX_GUARD_UIDS` | 2000. Past that, `enhancedUidGuardCss` returns `""` and warns |
| `ENHANCED_UID_CACHE_PREFIX` | `plexus-diagram:enhanced-uids:` |
| `PREPAINT_STYLE_ID` | `plexus-diagram-prepaint-guard` |
| `PENDING_CLASS` | `pxd-native-pending` |
| `NATIVE_HIDDEN_CLASS` | `pxd-native-hidden` |
| `OUTLINE_NATIVE_CLASS` | `pxd-outline-native` |
| `BLOCK_CONTAINER_SELECTOR` | `.roam-block-container` |
| `isDiagramString(value)` | true when `DIAGRAM_MARKER` matches |
| `cssAttributeValue(value)` | escapes `\` and `"` |
| `graphCacheKey(hash)` | the prefix plus the graph name, or `unknown` |
| `diagramUidFromLocation(hash)` | the page uid in `#/app/<graph>/page/<uid>`, else null |
| `routeLeftZoomedDiagram(diagramUid, hash)` | true when the open page uid is not `diagramUid` |
| `readEnhancedUidCache(storage, key)` | a `Set` of strings. Bad JSON is an empty set |
| `writeEnhancedUidCache(uids, storage, key)` | writes a sorted unique JSON array and returns it |
| `enhancedUidGuardCss(uids)` | CSS that sets `display:none` on native diagram chrome for those uids |
| `uidFromBlockInputId(id, isDiagramUid)` | the first `-` suffix, shortest first, that `isDiagramUid` accepts |
| `directChildWithClass(element, className)` | the first direct child with that class, or null |
| `blockContainerUid(container, isDiagramUid)` | the uid of that container's own block input |
| `embedWrap(native)` | the nearest `.rm-embed-container`, `.block-embed`, or `.rm-embed` |
| `embedOwnerUid(native, readString)` | the uid whose string is the embed macro, `"embed"` when the wrap has no owner, or null |
| `embedScope(native, readString)` | the element that means this copy |
| `embedBoardUid(native, readString)` | the board uid inside `{{[[embed]]: ((uid))}}`, or null |
| `findDiagramUidFromEl(element, isDiagramUid)` | a ref `data-uid`, then a block-input parse, then the zoomed hash, then `[data-uid]` |
| `diagramElForUid(uid, root)` | the first `.rm-diagram` under an id, data-uid, or block-ref match |
| `waitForDiagramEl(uid, {timeout=2500, root})` | the element, or null at the timeout |
| `diagramsWithin(root)` | `.rm-diagram` nodes in that subtree, including the root when it matches |
| `diagramInstanceInfo(nativeElement, enhancedUids)` | `{uid, nativeElement}` when that element is an enhanced diagram, else null |
| `isEnhancedProps(pulledProps)` | `readPlexus(props).v === SCHEMA_VERSION` |
| `readEnhanced(api, uid)` | a pull of `[:block/props]`. False on a miss or a throw |

## src/settings.js

| Export | Contract |
|---|---|
| `SETTING_IDS` | frozen map of camelCase key to kebab-case id |
| `settingsDefaults()` | a copy of the defaults |
| `normalizeSetting(id, value)` | boolean, number at least 40, or an enum member. Otherwise the default |
| `readSettings(extensionAPI)` | one normalized value per default id |
| `initializeSettings(extensionAPI)` | seeds each missing id and keeps the API for reset |
| `onSettingsChange(fn)` | returns an unregister function |
| `resetPlexusSettings()` | `settings.set` of each default, then `emit(id, value)` |
| `createSettingsPanel()` | `{ tabTitle: "Plexus Diagram", settings }`. No arguments |

| Panel row | Contract |
|---|---|
| group ids | `group-cards`, `group-sections`, `group-connections`, `group-board`, `group-performance` |
| group action | `reactComponent` that returns null |
| reset id | `reset-plexus-settings` |
| reset label | button content is exactly `Reset Plexus settings` |
| reset effect | open boards update through `view.setSettings`. The view stays mounted |
| `enabled: false` | still unmounts, in `feature.js`, not inside `resetPlexusSettings` |

| Id | Default |
|---|---|
| `enabled` | true |
| `fullscreen-on-zoom` | true |
| `graph-links` | `all` (`off`, `attributes`, `all`) |
| `attr-styles` | `""` |
| `wheel` | `pan` (`pan`, `zoom`) |
| `show-minimap` | true |
| `controls-position` | `rail` (`rail`, `bar`) |
| `snap-guides` | true |
| `snap-grid` | false |
| `grid` | `dots` (`dots`, `lines`, `grid`, `plain`) |
| `default-card-width` | 280 |
| `default-card-height` | 160 |
| `default-card-look` | `block` (`block`, `card`) |
| `enable-shortcuts` | true |
| `show-version-badge` | true |
| `disable-on-mobile` | true |
| `collapse-outline` | true |
| `board-tone` | `none` (`none`, `paper`, or a palette name) |
| `map-zoom` | `"0.45"` (`"0.3"`, `"0.45"`, `"0.6"`) |
| `auto-fit-sections` | true |
| `space-out` | false |
| `show-card-badges` | true |
| `show-palette` | true |
| `motion` | `full` (`full`, `reduced`, `none`) |

## src/model/attr-styles.js

| Export | Contract |
|---|---|
| `ATTR_DASHES` | `solid`, `dashed`, `dotted` |
| `parseAttrStyles(raw)` | an object or a JSON string becomes `{[name]: {color?, dash?}}`. A bad string, an array, or a non-object returns `{}` |
| color and dash | a color must be in `PALETTE`. A dash must be in `ATTR_DASHES`. A row with neither is dropped |
| `styleAttrLinks(links, styles, hidden)` | drops an attribute link whose name is hidden, and copies `color` and `dash` onto the rest |
| `attrLegend(links, hidden, styles)` | `[{name, color, dash, on}]`, one row per attribute name. `on` is false when the name is hidden |
| writes | none |

## src/model/changelog.js

| Export | Contract |
|---|---|
| `changelogEntry(markdown, version)` | the section from `## <version>` or `## <version> ` through the next `## ` heading |
| version token | a leading `v` is stripped. `1.2` does not match `## 1.2.0` |
| missing version | `""` |
| `CHANGELOG_TEXT` | `src/changelog-text.js`, rewritten by `build.mjs` `syncChangelogText` from `CHANGELOG.md` only when the bytes differ |
| import | pass `CHANGELOG_TEXT` into `changelogEntry`. Do not import `CHANGELOG.md` from product code |

## src/model/deeplink.js

| Export | Contract |
|---|---|
| `isShowableCard(plexus)` | finite `x` and `y`, and not a section, an edges container, or an edge |
| `pageUidFromHash(hash)` | the page uid, or `""` |
| `graphFromDeepLink(hash)` | the graph name, or `""` |
| `cardDeepLink({graph, pageUid, cardUid})` | `#/app/<graph>/page/<page>?pxd=<card>`, or `""` unless each part matches `^[\w-]{1,32}$` |
| `hashFromUrl(url)` | the `#…` slice. Roam drops `?pxd=` from `location.hash` before listeners run. `hashchange` `newURL` still has it |
| `pxdTarget(hash)` | `{cardUid, pageUid, graph}` or null |
| `copyLinkText(item, {graph, pageUid, cardUid})` | the semantic ref, plus the URL on the next line when the link is valid |
| `locateShowTarget(uid, placements)` | a card whose uid matches beats a ref. Ties sort by board uid, then card uid |
| `assignDeepLink(loc, ids, onSame)` | sets `loc.hash`. When it already matches, calls `onSame` and does not assign |

## src/model/find.js

| Export | Contract |
|---|---|
| `findOnBoard(board, query, nested=[])` | case-insensitive hits. An empty query returns `[]` |
| item hit | `{uid, focus: uid, kind: "section"\|"card"}` from the title, the card string, and child strings |
| edge hit | `{uid, focus: edge.from, kind: "edge"}` from the label and the edge string |
| nested hit | `nested` entries are `{parentUid, board}`. A hit inside one is `{uid, focus: parentUid, kind: "nested", via: parentUid}` |

## src/model/info.js

| Export | Contract |
|---|---|
| `PANEL_WIDTH_MIN` / `MAX` / `DEFAULT` | 260 / 640 / 340 |
| `nextPanelWidth(current, delta, {min, max})` | a negative delta widens. The result stays inside min and max |
| `infoTabList(tabs, uid, {add=false})` | `{tabs, current}`. `add: false` only selects a uid that is already open |
| `closeInfoTab(tabs, current, uid)` | drops that tab. Closing the current tab selects the neighbor that slides into its place |
| `attributeRows(strings)` | `[{name, value}]` for strings `attrNameOf` accepts |
| `tagNames(text)` | `#tag` and `#[[Page]]`, once each, first-seen order |
| `boardsFromRows(rows, {limit=20})` | `{uid, title, pageTitle}`. A row whose `v` is present and not 2 is dropped. A missing `v` is kept |

## src/model/kanban.js

| Export | Contract |
|---|---|
| `TODO_FIELD` | `To do` |
| `DONE_COLUMN` | `Done` |
| `todoState(string)` | `""`, `To do`, or `Done` from the first `{{[[TODO]]}}` or `{{[[DONE]]}}` |
| `kanbanRows(board)` | `tableRows` plus each card's string |
| `kanbanFields(rows)` | `[TODO_FIELD, ...attribute names]` that pass `columnNameOk` |
| `kanbanColumns(rows, field)` | the marker field always has To do and Done, plus an empty-name column for cards with no marker |
| attribute columns | the values already on the cards. A bad field name returns `[]` |
| `planKanbanMove({field, column, row})` | null for an empty column, a no-op, or a bad field |
| marker move | `{op:"string", uid, string}` with `{{[[TODO]]}}` or `{{[[DONE]]}}` |
| attribute move | the same shape for an existing child, or `{op:"create", parent, string}` from `planAttrCell` |
| open | writes nothing |

## src/model/lens.js

| Export | Contract |
|---|---|
| `tagsForCard(item, extra="")` | `tagNames` of the card string, `content` child strings, and `extra` |
| `lensCatalog(cards)` | `{tags, byUid}`. Tags stay in first-seen order. `byUid` maps each card uid to its tag list |
| `lensBright(byUid, tag, focusSet=null)` | cards carrying `tag`. An empty tag returns `focusSet` as a Set, or null when there is no focus set. A tag plus a focus set returns the overlap |

## src/model/library.js

| Export | Contract |
|---|---|
| `LIBRARY_TYPES` | `all`, `page`, `block`, `board`, `daily` |
| `isDailyTitle(title)` | a Roam daily title, including the `st` / `nd` / `rd` / `th` suffix |
| `normalizeLibraryFilter(raw)` | `{type, tag, days, orphan, text}`. `days` of 0 means no date cutoff |
| `libraryFilterActive(filter)` | true when text, tag, days, orphan, or a non-`all` type is set |
| `librarySelective(filter)` | true for a text or tag filter, or for type `board` or `daily` |
| `editedSince(edited, days, now=Date.now())` | true when `days` is 0, or `edited` is inside that many days |
| `libraryKind(row)` | `board`, `block`, `daily`, or `page` |
| `narrowLibrary(rows, filter, now)` | applies type, tag, text, days, and orphan. `orphan: true` drops boards and rows with `onBoard` |
| `libraryCard(row)` | page and daily are `[[title]]`. Board and block are `((uid))`. Returns `{string, text, kind, label}` |
| `recentDailyTitles(days=14, now=new Date())` | local noon, newest first, clamped to 1..366 |
| `libraryCap()` | 80 |

## src/model/mindmap.js

| Export | Contract |
|---|---|
| `MIND_DIRECTIONS` | `right`, `down`, `balanced`, `radial` |
| `MIND_SPACINGS` | `compact`, `normal`, `airy` |
| `MIND_DEPTH_MIN` / `MAX` | 1 / 4 |
| `MIND_PRESET_KEY` | `plexus-diagram:mindmap-preset` |
| `MIND_GAPS.compact` | `{hGap:40, vGap:12}` |
| `MIND_GAPS.normal` | `{hGap:80, vGap:24}` |
| `MIND_GAPS.airy` | `{hGap:140, vGap:48}` |
| `DEFAULT_MIND_PRESET` | `{direction:"right", spacing:"normal", depth:3, includeRefs:true, colorBranches:false}` |
| `normalizeMindPreset(raw)` | invalid fields fall back. `includeRefs` is false only when the raw value is false. `colorBranches` is true only when the raw value is true |
| `readMindPreset(storage)` | the stored preset, or the default. A throw returns the default |
| `writeMindPreset(storage, patch)` | merges the patch, writes JSON, and returns the stored preset |
| `branchColor(index)` | `PALETTE[index % 10]` |
| store | `localStorage` only. Not a Roam setting and not a board write |

## src/model/namespace.js

| Export | Contract |
|---|---|
| `namespaceParent(title)` | the text before the first `/`. No slash, a leading slash, or a trailing slash returns null |
| `dropNamespace(strings)` | page cards only. One shared parent returns `{parent, indexes}`. Mixed parents return null |

## src/model/neighbors.js

| Export | Contract |
|---|---|
| `NEIGHBOR_CAP` | 24 |
| `pageRefString(title)` | `[[title]]`, or null for an empty title, `]]`, or a newline |
| `splitNeighbors({outgoing, incoming, selfTitle, selfUid})` | `{out, in, attr}`, each capped at 24 |
| outgoing rows | `[title, string]`. An `attrNameOf` hit goes to `attr`. Other titles go to `out` |
| incoming rows | `[uid, string, title]`. Counted, then sorted by count, then title |
| `neighborLayout(rect, titles, {skip})` | `[{string, x, y}]` on a ring of radius `max(w,h)/2 + 240`, card size 280×160, starting at the top. `skip` drops titles. Nothing is written |

## src/model/query.js

| Export | Contract |
|---|---|
| `QUERY_CARD_CAP` | 45 |
| `isQueryString(s)` | the whole block is `{{[[query]]}}` or `{{query}}`, with an optional `:…` body |
| `blockUidFromDomId(id)` | a 9-character uid that is the whole id, or the last 9 characters when the character before them is `-` |
| `queryResultUids(root, skipUid)` | uids from `[id]` under `root`, skipping `skipUid` |
| `queryResultLayout(rect, uids)` | `((uid))` cards on the same ring as neighbors, capped at 45 |

## src/model/refs.js

| Export | Contract |
|---|---|
| `LINKED_REF_CAP` | 20 |
| `linkedRefLabel(count)` | `1 linked reference`, or `N linked references`. A non-finite count reads as 0 |
| `linkedRefCard(uid)` | `((uid))` for a 9-character uid of letters, digits, `_`, and `-`. Otherwise null |

## src/model/shapes.js

| Export | Contract |
|---|---|
| `SHAPES` | `rectangle`, `rounded`, `ellipse`, `diamond`, `parallelogram`, `cylinder` |
| `shapePoint(rect, shape, side)` | the bbox midpoint of `top`, `right`, `bottom`, or `left`. A parallelogram moves those anchors in by `min(w * 0.18, 28)` |
| `shapePath(rect, shape)` | an SVG path. Any other shape name uses the rectangle path |
| imports | none. `schema.js` imports `SHAPES` |

## src/model/snapshots.js

| Export | Contract |
|---|---|
| `SNAPSHOTS_TITLE` | `Snapshots` |
| `SNAPSHOT_KEEP` | 10 |
| `SNAPSHOT_CHUNK` | 45 |
| `snapshotTitle(date)` | `YYYY-MM-DD HH:MM`, or `""` for an invalid date |
| `captureLayout(board)` | `[{uid, x, y, w, h, color, collapsed, parent}]` in `board.order`. `color` is null when missing. `parent` is `parentUid` |
| `snapshotProps(items)` | `{type:"snapshot", json: JSON.stringify({items})}` |
| `parseSnapshot(plexus)` | items when `type` is `snapshot` and `json` is `{items:[{uid}]}`. Otherwise null |
| `listFromNodes(nodes)` | `[{uid, title, items}]` from each node's plexus |
| `partitionSnapshots(list)` | block order is oldest first. `newest` is the last 10, latest first. `older` is the rest, also latest first |
| `planRestore(entries, board)` | chunks of at most 45 ops. A move when the stored parent is the board or a section and differs. Props when x, y, w, h, color, or collapsed differ. A missing item is skipped |

## src/snapshots.js

| Method | Contract |
|---|---|
| registration | importing the module calls `extendSession` |
| `session.saveSnapshot(now=new Date())` | creates a collapsed `Snapshots` child (`type:"snapshots"`) when missing, then one child titled `snapshotTitle(now)`. Returns that uid, or null |
| `session.restoreSnapshot(snapUid)` | one transaction per `planRestore` chunk. Toasts `Restored <title>`. Returns false when the snapshot is missing |
| `session.deleteSnapshot(snapUid)` | deletes that block. Returns false when it is missing |

## src/model/table.js

| Export | Contract |
|---|---|
| `columnNameOk(name)` | false for an empty name, a name starting with `BT_attr`, or a fixed column name |
| fixed columns | `Title`, `Section`, `Type`, `Edited` |
| `isTableRow(item)` | cards and nested boards. Sections and text are not rows. `kind` `card` or `board` counts when `type` is absent |
| `tableColumns(rows)` | the four fixed names, then each attribute name once |
| `cellText(row, column)` | the fixed field, or that attribute's value |
| `filterRows(rows, text)` | rows whose any cell contains the text. An empty filter returns a copy |
| `sortRows(rows, column, dir="asc")` | `Edited` sorts numerically. Other columns sort with `localeCompare` |
| `planAttrCell({name, value, blockUid, parentUid})` | an existing child updates even when the text is empty (`Name::`). A new empty cell returns null. A new filled cell is `{op:"create", parent, string}`. An update is `{op:"update", uid, string}` |
| `tableRows(board)` | one row per card and nested board, in board order. Attribute children keep their block uid |

## src/model/tasks.js

| Export | Contract |
|---|---|
| `parseRoamDay(title)` | `{y, m, d}` for a Roam daily title, or null |
| `dueChip(content, today=new Date())` | `{text, overdue, raw}` from the first child whose attribute name is `BT_attrDue`, or null |
| value | `[[title]]` or a bare title |
| `overdue` | true when that day is before `today` on the local calendar |
| writes | the string is never rewritten. `BT_attr*` stays with Better Tasks |

## src/model/templates.js

| Export | Contract |
|---|---|
| `TEMPLATE_PAGE` | `Plexus Diagram/Templates` |
| `TEMPLATE_WRITE_CAP` | 45 |
| `STARTERS` | `{id, title, tree}` |
| starter ids | `five-why`, `fishbone`, `8d`, `swot`, `kanban`, `timeline`, `process`, `meeting`, `retro` |
| `starterById(id)` | that starter, or null |
| `rewriteEdgeEnds(creates, uidMap)` | edge `from` and `to` go through `uidMap` |
| `chunkCreates(creates, cap=45)` | slices of at most `cap` |
| `templateUndo(rootUid)` | `{op:"delete", uid}`, or null |
| `planCopy(tree, {genUid, parentUid, plexusPatch})` | `{rootUid, creates, chunks, uidMap}` via `planSubtreeClone` |
| `planTemplate(id, opts)` | that plan plus `{id, title}`, or null |

## src/templates.js

| Method | Contract |
|---|---|
| registration | importing the module calls `extendSession` |
| `session.insertTemplate(id, rect)` | places the starter at `rect` (default board-card size). The parent comes from `containerAt`. Each chunk is one transaction. Toasts `Inserted <title>` with an Undo that deletes the root. Returns the root uid, or null |
| `session.saveAsTemplate()` | copies the open board onto `TEMPLATE_PAGE` through `host.group` and `host.createBlock`, 45 creates per group. Undo deletes the root. Returns the root uid, or null |

## src/model/stress-board.js

| Export | Contract |
|---|---|
| role | test helper for the 300-card timing board. Not a Roam-facing API. No Roam calls |
| `STRESS_CARDS` / `STRESS_SECTIONS` / `STRESS_EDGES` | 300 / 20 / 150 |
| `STRESS_TITLE` | `PF2 stress` |
| `stressBoardTree()` | a pulled-shaped tree |
| `planStressBoard({genUid, parentUid})` | `planCopy` of that tree |

## src/view/motion.js

| Export | Contract |
|---|---|
| `MOTION_LEVELS` | `full`, `reduced`, `none` |
| `MOTION_PROFILE.full` | `{zoomMs:180, presentMs:160, pulseMs:1800, edges:true}` |
| `MOTION_PROFILE.reduced` | `{zoomMs:70, presentMs:60, pulseMs:400, edges:false}` |
| `MOTION_PROFILE.none` | `{zoomMs:0, presentMs:0, pulseMs:0, edges:false}` |
| `resolveMotion(value, prefersReduced=false)` | an unknown value is `full`. `none` stays `none`. `full` with `prefersReduced` becomes `reduced` |
| `motionProfile(level)` | that profile, or `full` |
| `applyMotionClasses(root, level)` | `pxd-root--motion-off` for reduced and none, exactly one of `--motion-reduced` or `--motion-none`, `data-motion`, and `--pxd-zoom-ms`, `--pxd-present-ms`, `--pxd-pulse-ms` |

## src/view/shortcuts.js

| Export | Contract |
|---|---|
| `SHORTCUTS` | the only key list. The sheet renders it and the key handler matches it |
| row | `{group, keys, label, action, match, events, tool?, letter?, mode?}` |
| `findShortcut(ev, mode="normal")` | the row whose `mode` (default `"normal"`) equals `mode` and whose `match` accepts `ev` |
| modes | Present rows use `present`. Space and Escape use `always`. Shift+F10 uses `view` |
| `⌘` | meta or ctrl |
| count | 45 rows in Tools, Edit, Select, View, Navigate, Present |
| `M` | action `expand`, label `Expand outline` |

## src/view/shortcut-sheet.js

| Export | Contract |
|---|---|
| `createShortcutSheet({doc, root, shortcuts=SHORTCUTS})` | `{open, close, toggle, isOpen}` |
| dialog | `role="dialog"`, `aria-label="Shortcuts"`. Close takes focus |
| rows | `keys` and `label`, grouped by `group` |

## src/view/empty-hint.js

| Export | Contract |
|---|---|
| `EMPTY_HINT` | `Double-click to add a block · drag bullets from the outline · press ? for shortcuts` |
| `boardIsEmpty(board)` | `board.items.size === 0` |
| `syncEmptyHint(node, board)` | shows the hint and clears `hidden`, or sets `hidden`. A missing node returns false |

## src/view/editor-keys.js

| Export | Contract |
|---|---|
| `blockUidFromNode(node)` | walks ancestors for `block-input-<uid>`, a uid id, or `data-uid`. A uid here is 9–15 characters |
| `inputBlockRole(node, rootUid)` | `{role:"child"\|"root", uid}`. A node inside `.rm-block-children` inside `.pxd-item__editor` is a child. So is a uid that is not `rootUid` |
| `editorKeyAction(opts)` | `{type:"roam"}` for autocomplete, Tab, and Cmd/Ctrl+Enter. Backspace on a fresh empty root is `{type:"delete-card"}`. Enter stays `{type:"roam"}` |

## src/view/editor-scale.js

| Export | Contract |
|---|---|
| `editorCounterScale(zoom, baseFont=14)` | `{z, width, height, transform, fontPx}`, or null when zoom is within 0.001 of 1 or not finite |
| `applyEditorCounterScale(editor, zoom, baseFont=14)` | applies `scale(1/z)` with width and height `z*100%` and textarea font `baseFont*z` px. Returns true when applied |

## src/view/editor-menus.js

| Export | Contract |
|---|---|
| `placeEditorMenus(doc, anchor)` | pins `.rm-autocomplete__results`, `.bp3-datepicker`, and `.rm-date-picker` to the anchor's screen box. Returns how many were pinned |
| date picker | an ancestor transform that is a real translation is cleared so the calendar meets the button |
| `watchEditorMenus(doc, getAnchor, onIdle)` | a stop function. After 12 frames with no anchor it calls `onIdle` |

## src/view/props-panel.js

| Export | Contract |
|---|---|
| `createPropsPanel({doc, root, storage, on})` | `{el, refresh, place, isCollapsed, dispose}` |
| collapsed | `localStorage` key `pxd-props-collapsed` (`"1"` collapsed). Not a Roam prop |
| `refresh(state)` | reads `state.items`, `state.edge`, and `state.board`. Skips a repaint while an input inside the panel is focused |
| callbacks | optional `setItemStyle`, `resetItems`, `setEdge`, `resetEdge`, `setDefaults`, `resetDefaults`, `setBackground`, `setSectionStyle`, `resetSections` |
| patterns | includes `cross` |

## src/view/kanban-view.js

| Export | Contract |
|---|---|
| `mountKanban({doc, root, host, getBoard})` | `{el, open, close, refresh, dispose}` |
| re-exports | `DONE_COLUMN`, `TODO_FIELD` |
| `open` | paints `kanbanColumns` |
| drop | writes the one `planKanbanMove` plan through the host |
| `close` / `dispose` | write nothing |

## src/view/table-view.js

| Export | Contract |
|---|---|
| `mountTable({doc, root, host, getBoard})` | `{el, open, close, refresh, dispose}` |
| cells | an existing attribute cell mounts `host.renderBlock` on that child |
| add column | the name stays local until a cell is filled. That fill is the only write, via `planAttrCell` |

## src/view/board-picker.js

| Export | Contract |
|---|---|
| `recentBoardRows(rows)` | rows with a uid, newest `edited` first, then title |
| `openAddToBoard({doc, listBoards, onPick})` | `{close}`. One picker, on `document.body`, class `pxd-addboard` |
| pick | `onPick(board)`. Closes unless the promise resolves `false` |
| Escape | closes from the filter |

## src/view/color-picker.js

| Export | Contract |
|---|---|
| `buildColorPicker(doc, onPick, listen)` | the picker element |
| rows | the 13 `NATIVE_SWATCHES`, those hexes darkened by 0.28, those hexes lightened by 0.4, a `#rrggbb` field, the palette names, and `No color` |
| named click | passes the palette name |
| hex click | passes lowercase hex from `hexColor` |
| `No color` | `onPick(null)` |

## src/view/fullscreen.js

| Export | Contract |
|---|---|
| `topbarOffset(root)` | the bottom of `.rm-topbar`, in px |
| `sidebarOffset(root)` | the right edge of the left sidebar, or 0 |
| `fullscreenInsets(root)` | `{top, left, right, bottom}` from the topbar and `.rm-article-wrapper` |
| `applyFullscreenChrome(mount, on, root)` | `on` adds `pxd-mount--fullscreen` and `body.pxd-has-fullscreen`, then follows sidebar resize. `off` clears the classes and the inset styles. Returns a disposer |
| `watchRouteExit({boardUid, onExit, win})` | calls `onExit` when `routeLeftZoomedDiagram` becomes true. Returns a disposer |
