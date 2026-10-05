# Batch 3-11 — 2.10.1 ECO-2 and ECO-3

ECO-2 publishes window.PlexusDiagram. ECO-3 shows a Roam Plexus region ref as a crop card. Typing bench is waived. Do not edit roam-plexus. The palette stays the two commands already in feature.js. No new block string and no new props kind.

Measurements are the two 2.10.1 bullets in docs/roadmap.md section 8. A valid Roam Plexus region parses with owner roam-plexus and supported false. That false flag is success. img and view stay owner plexus-diagram.

## Data model

The card string stays `((uid))`. Kind region-ref exists only in memory, after buildBoard pulls the target. Nothing is cached to disk or localStorage.

## Public API

Frozen object, apiVersion 1. Methods: isAvailable, boardsOn, boardsWith, cardsOf, regionsOf, viewsOf, thumbnail, open, addCard, addEventListener, removeEventListener, spec, help. spec().methods is those names, sorted. Events on the object are change, mount, and unmount. Window events are plexus-diagram:ready and plexus-diagram:unload. Listener throws are swallowed. Unload deletes window.PlexusDiagram only when it is still ours, and always fires unload. A foreign object is left in place. window.__plexusDiagram stays the debug handle.

boardsWith uses SHOW_REF_QUERY and keeps plexus.v === 2. fast.q returns rows. boardsOn(pageUid) is the boards that live on that page. It is not boardsWith. addCard accepts only one `[[Page]]` or `((uid))`, refuses a board that is not enhanced, and creates one child. applyFit on that same child is allowed. It emits change once: `{ boardUid, uid }`.

thumbnail(boardUid, {maxWidth}) rasterises our minimap through OffscreenCanvas, or a hidden canvas that is removed. The PNG width is at most maxWidth pixels. The warm call stays under 100 ms. It never calls Roam render. Default maxWidth is 160.

open(boardUid, {card}) pans to that card and pulses it. {view} sets the camera with setCameraFromView and does not write. {sidebar} opens the board in the sidebar first. {region} is a view uid and uses the same camera path.

## Region card

regionRefKind(targetString, api) returns region-ref only when api.apiVersion is at least 6, parseRegion has owner roam-plexus, and error is absent. supported false does not reject. img and view return null. A missing API returns null.

The body calls RoamPlexus.thumbnail(uid, {maxWidth}) and does not pass render. CSS uses max-width 100%. A null blob shows the caption and no image. Map tier and an offscreen shell do not call thumbnail. Resize end requests once. Object URLs are revoked on replace and unmount. No module map of blobs.

Hover buttons are Open drawing and Open in sidebar. They call RoamPlexus.open(uid, {region: true}), and the same with sidebar true. A 1px border carries the button. Class pxd-item--region. Listen for RoamPlexus change, and for roam-plexus:ready and roam-plexus:unload. Switch the kind with no write.

## Files

src/model/public-api.js owns the frozen object, the queries, and addCard checks. Test: test/public-api-210.test.js.

src/model/region-card.js owns regionRefKind. Test: test/region-card-210.test.js.

src/view/region-card.js owns the crop body and the toolbar. Fake-DOM test: test/region-card-view-210.test.js.

The integrator then wires feature.js, src/model/board.js, src/view/cards.js, and src/session.js. No fourth palette command.

## Acceptance

ECO-2: spec().methods lists the names above. boardsWith(pageUid) for a page on two enhanced fixture boards returns both. thumbnail(boardUid, {maxWidth: 160}) is a PNG at most 160 px wide. The warm call is under 100 ms. open(boardUid, {card}) lands and pulses. {view} sets the camera. addCard creates one child with plexus props and emits change. Unload deletes the global and fires plexus-diagram:unload.

ECO-3: paste `((eyjMKi1DA))` on the Test Lab board. The crop card shows the caption. Shots in light and dark. Open shows the full-screen editor zoomed to the region, then minimize it. Remove the Roam Plexus Pages URL and add that same URL back. Do not dev-load it into Test Lab. The card becomes a plain ref, with no error. Resize requests the thumbnail once more. Writes stay at the one card create.

## Live

Ledger only the new Test Lab blocks. Leave page 8eai6ikkw and region eyjMKi1DA. After the unload check, the Pages URL is back and apiVersion is 7. Theme returns to Auto. Stub window.confirm. Copy from the OS clipboard stays under Limits if readText fails. Palette count stays 2.

## Critic amendments

These override earlier sentences. Do not reuse rasterizeSvg. It sets the canvas to twice the svg width, so a 160 svg becomes a 320 PNG. thumbnail draws at maxWidth pixels. Pass v as the union of the card rects. Set the stroke to the computed border color before drawing. currentColor is invisible on a blob image.

The region skip in buildBoard uses the card's own string. Pull the target only after that skip. A target that parses as a region does not drop the card. Set kind to region-ref on that same item, and set its title to the region caption so map tier still shows it after the body unmounts.

addCard parents the new child to the board root. It does not call containerAt or applyFit. One create. A paste inside a section may still grow that section. That is existing paste, not addCard. The resize check may write that card's w and h once. The one-create check is the paste itself.

Live paste clicks the board Paste menu only after readText returns exactly `((eyjMKi1DA))`. pasteFromMenu pastes lastPayload when readText fails. Do not click Paste in that case. A failed read stays under Limits.

{view} is a view uid. Pull that block and pass region.v to setCameraFromView only when kind is view and supported is true. A uid is not a camera. {sidebar} waits until that sidebar mount has a view and is not dormant, then pans only that copy. A dormant sidebar has no view, and pickCameraMount would otherwise move the main board.

Open drawing calls openBlock on the drawing, so the main window leaves Test Lab. After the shot, minimize, then open the Test Lab page again before unload and resize. Roam Plexus syncOnClose may write the drawing. That is not a Plexus Diagram write. Plexus Diagram writes on that step stay at the one card. Do not delete the spike page.
