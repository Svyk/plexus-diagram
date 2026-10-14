"""Checkbox and circled-option state on synthetic scanned forms."""

import math
import random

import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from plexus_parse_helper.checkmarks import _can_cut, _can_tail, apply_checkmarks

DPI = 300
SCALE = DPI / 72.0
PAGE = (612, 792)


class Form:
    """A white page at 300 dpi, with the OCR lines a reader would return for what is drawn on it."""

    def __init__(self, font_pt: float = 10.0):
        self.img = Image.new("L", (int(PAGE[0] * SCALE), int(PAGE[1] * SCALE)), 255)
        self.draw = ImageDraw.Draw(self.img)
        self.fp = font_pt * SCALE
        self.font = ImageFont.load_default(size=int(self.fp))
        ascent, descent = self.font.getmetrics()
        self.line_h = ascent + descent
        self.lines: list[dict] = []
        self.x = 0.0
        self.y = 0.0
        self.parts: list[tuple[float, float]] = []

    # ---- drawing, left to right along one line ----

    def start(self, x_pt: float, y_pt: float):
        self.x, self.y = x_pt * SCALE, y_pt * SCALE
        self.parts = []
        self.read: list[str] = []
        return self

    def word(self, text: str, read: str | None = None, gap: float = 0.3):
        self.draw.text((self.x, self.y), text, font=self.font, fill=0)
        x1 = self.draw.textbbox((self.x, self.y), text, font=self.font)[2]
        self.parts.append((self.x, x1))
        self.read.append(text if read is None else read)
        self.x = x1 + gap * self.fp
        return self

    def box(self, state: str = "empty", read: str = "", gap: float = 0.25):
        side = 0.8 * self.fp
        top = self.y + (self.line_h - side) / 2
        x0, y0, x1, y1 = self.x, top, self.x + side, top + side
        w = max(2, int(round(0.07 * side)))
        if state == "solid":
            self.draw.rectangle([x0, y0, x1, y1], fill=0)
        else:
            self.draw.rectangle([x0, y0, x1, y1], outline=0, width=w)
        if state == "tick":
            self.draw.line([(x0 + 0.15 * side, y0 + 0.55 * side), (x0 + 0.4 * side, y1 - 0.12 * side),
                            (x1 + 0.35 * side, y0 - 0.45 * side)], fill=0, width=w + 2)
        elif state == "x":
            self.draw.line([(x0 + 0.2 * side, y0 + 0.2 * side), (x1 - 0.2 * side, y1 - 0.2 * side)], fill=0, width=w + 1)
            self.draw.line([(x1 - 0.2 * side, y0 + 0.2 * side), (x0 + 0.2 * side, y1 - 0.2 * side)], fill=0, width=w + 1)
        self.parts.append((x0, x1))
        if read:
            self.read.append(read)
        self.x = x1 + gap * self.fp
        return self

    def ring_last(self, open_gap: float = 0.0):
        """A hand-drawn ellipse around the last word; `open_gap` leaves that share of it undrawn."""
        x0, x1 = self.parts[-1]
        pad_x, pad_y = 0.35 * self.fp, 0.3 * self.fp
        bbox = [x0 - pad_x, self.y - pad_y, x1 + pad_x, self.y + self.line_h + pad_y]
        start = 300.0 * open_gap
        self.draw.arc(bbox, start=start, end=360, fill=0, width=4)
        return self

    def end(self):
        """Record the OCR line: text as read, box from the first part to the last."""
        x0 = min(p[0] for p in self.parts) - 0.05 * self.fp
        x1 = max(p[1] for p in self.parts) + 0.05 * self.fp
        bbox = [x0 / SCALE, self.y / SCALE, x1 / SCALE, (self.y + self.line_h) / SCALE]
        self.lines.append({"text": " ".join(r for r in self.read if r), "bbox": [round(v, 3) for v in bbox], "ocr": True})
        return self

    def text_line(self, x_pt: float, y_pt: float, text: str):
        return self.start(x_pt, y_pt).word(text).end()

    # ---- page variants ----

    def noisy(self, seed: int = 7):
        rnd = random.Random(seed)
        px = self.img.load()
        w, h = self.img.size
        for _ in range(w * h // 1500):
            px[rnd.randrange(w), rnd.randrange(h)] = rnd.choice((0, 90, 160))
        self.img = self.img.filter(ImageFilter.GaussianBlur(0.7))
        return self

    def skewed(self, degrees: float):
        """Turn the page about its centre and move every OCR box with it (axis-aligned hull)."""
        self.img = self.img.rotate(degrees, resample=Image.BICUBIC, fillcolor=255)
        cx, cy = PAGE[0] / 2, PAGE[1] / 2
        a = math.radians(degrees)

        def move(x, y):
            dx, dy = x - cx, y - cy
            return cx + dx * math.cos(a) + dy * math.sin(a), cy - dx * math.sin(a) + dy * math.cos(a)

        for line in self.lines:
            x0, y0, x1, y1 = line["bbox"]
            pts = [move(x, y) for x in (x0, x1) for y in (y0, y1)]
            line["bbox"] = [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)]
        return self

    def sideways(self, clockwise: bool = True):
        """The sheet scanned a quarter turn round: the page becomes landscape."""
        w, h = PAGE
        self.img = self.img.transpose(Image.Transpose.ROTATE_270 if clockwise else Image.Transpose.ROTATE_90)
        for line in self.lines:
            x0, y0, x1, y1 = line["bbox"]
            line["bbox"] = [h - y1, x0, h - y0, x1] if clockwise else [y0, w - x1, y1, w - x0]
        return self

    # ---- running the pass ----

    def run(self, tmp_path, name: str = "form", table: bool = False):
        pdf = tmp_path / f"{name}.pdf"
        self.img.convert("RGB").save(pdf, "PDF", resolution=DPI)
        w_pt, h_pt = self.img.size[0] / SCALE, self.img.size[1] / SCALE
        blocks, order = {}, []
        for i, line in enumerate(self.lines):
            bid = f"b{i + 1}"
            blocks[bid] = {"id": bid, "type": "para", "page": 1, "bbox": line["bbox"], "text": line["text"]}
            order.append(bid)
        doc = {
            "pages": [{"n": 1, "w": w_pt, "h": h_pt, "rotation": 0, "kind": "scan", "parsed": True}],
            "order": order,
            "blocks": blocks,
            "stats": {},
        }
        doc = apply_checkmarks(doc, pdf, {1: [dict(l) for l in self.lines]})
        return [doc["blocks"][b]["text"] for b in order], doc["stats"]["checkmarks"]


def positive_form(font_pt: float) -> Form:
    f = Form(font_pt)
    f.text_line(150, 120, "Daily Line Check Form")
    f.text_line(150, 150, "Department: Quality")
    f.start(150, 200).box("tick", read="Z").word("Pass", gap=1.2).box("empty", read="O").word("Fail").end()
    f.start(150, 240).word("Result:").box("x", read="X").word("Accept", gap=1.2).box("empty").word("Reject").end()
    f.start(150, 280).box("tick", read="M").word("Clean").end()
    f.start(150, 310).box("empty").word("Dry").end()
    f.start(150, 340).box("solid").word("Sealed").end()
    f.start(150, 390).word("Sample OK:").word("YES").ring_last().word("/").word("NO").end()
    f.start(150, 440).word("Test:").word("Pass", gap=0.8).word("Fail").ring_last(open_gap=0.08).end()
    f.text_line(150, 490, "Checked by the shift lead before release")
    return f


EXPECTED = [
    "Daily Line Check Form",
    "Department: Quality",
    "[x] Pass [ ] Fail",
    "Result: [x] Accept [ ] Reject",
    "[x] Clean",
    "[ ] Dry",
    "[x] Sealed",
    "Sample OK: [x] YES / NO",
    "Test: Pass [x] Fail",
    "Checked by the shift lead before release",
]


@pytest.mark.parametrize("font_pt", [9.0, 13.0])
def test_boxes_and_rings_at_two_scales(tmp_path, font_pt):
    texts, stats = positive_form(font_pt).run(tmp_path)
    assert texts == EXPECTED
    assert stats["boxes"] == 7 and stats["checked"] == 4 and stats["circles"] == 2


def test_skew_and_noise(tmp_path):
    texts, stats = positive_form(10.0).skewed(1.2).noisy().run(tmp_path)
    assert texts == EXPECTED
    assert stats["circles"] == 2


@pytest.mark.parametrize("clockwise", [True, False])
def test_sideways_scan(tmp_path, clockwise):
    texts, _ = positive_form(10.0).sideways(clockwise).run(tmp_path)
    assert texts == EXPECTED


def test_a_page_with_a_text_layer_is_left_alone(tmp_path):
    f = positive_form(10.0)
    pdf = tmp_path / "t.pdf"
    f.img.convert("RGB").save(pdf, "PDF", resolution=DPI)
    doc = {"pages": [{"n": 1, "w": 612, "h": 792, "kind": "text"}], "order": ["b1"],
           "blocks": {"b1": {"id": "b1", "type": "para", "page": 1, "bbox": f.lines[2]["bbox"], "text": f.lines[2]["text"]}}}
    doc = apply_checkmarks(doc, pdf, {1: f.lines})
    assert doc["blocks"]["b1"]["text"] == "Z Pass O Fail"
    assert doc["stats"]["checkmarks"]["boxes"] == 0


def test_a_state_docling_already_labelled_is_not_repeated(tmp_path):
    f = Form(10.0)
    f.text_line(150, 120, "Release record")
    f.text_line(150, 150, "Department: Quality")
    f.start(150, 200).box("tick", read="X").word("Analytical Data").end()
    f.lines[2]["text"] = "[x] X Analytical Data"
    texts, _ = f.run(tmp_path)
    assert texts[2] == "[x] X Analytical Data"


# ---- negatives: nothing may be marked ----

def _assert_unmarked(texts, stats, lines):
    assert stats["placed"] == 0
    assert texts == [l["text"] for l in lines]
    assert not any("[x]" in t or "[ ]" in t for t in texts)


def test_square_bullets(tmp_path):
    f = Form(10.0)
    f.text_line(150, 100, "Procedure notes")
    for i, item in enumerate(["Wear gloves in the blend room", "Close the hatch after sampling", "Record the lot on the sheet"]):
        f.start(150, 140 + 30 * i).box("solid", read="■").word(item).end()
    texts, stats = f.run(tmp_path)
    _assert_unmarked(texts, stats, f.lines)


def test_hollow_square_list_rendered_as_image(tmp_path):
    f = Form(10.0)
    f.text_line(150, 100, "Before you start")
    for i, item in enumerate(["Read the safety sheet", "Check the scale date", "Tare the container", "Label the sample bag"]):
        f.start(150, 140 + 30 * i).box("empty").word(item).end()
    texts, stats = f.run(tmp_path)
    _assert_unmarked(texts, stats, f.lines)


def test_letters_o_d_and_zero_in_text(tmp_path):
    f = Form(12.0)
    for i, line in enumerate(["DOOR 0010 ODD COD", "BOX 00 DO OD O D 0", "ROOM D-100 ZONE 0", "Code O0D0 lot 0D0O"]):
        f.text_line(120, 120 + 40 * i, line)
    # A bold copy: the same text drawn with a heavy stroke.
    f.start(120, 300)
    f.draw.text((f.x, f.y), "DOD 000 OOD", font=f.font, fill=0, stroke_width=3, stroke_fill=0)
    x1 = f.draw.textbbox((f.x, f.y), "DOD 000 OOD", font=f.font, stroke_width=3)[2]
    f.parts.append((f.x, x1))
    f.read.append("DOD 000 OOD")
    f.end()
    texts, stats = f.run(tmp_path)
    _assert_unmarked(texts, stats, f.lines)
    assert stats["boxes"] == 0


def _grid(f: Form, x_pt: float, y_pt: float, cols: list[float], rows: int, row_h: float, cells: dict):
    """A ruled table; `cells` maps (r, c) to text written in that cell."""
    xs = [x_pt]
    for w in cols:
        xs.append(xs[-1] + w)
    ys = [y_pt + i * row_h for i in range(rows + 1)]
    for x in xs:
        f.draw.line([(x * SCALE, ys[0] * SCALE), (x * SCALE, ys[-1] * SCALE)], fill=0, width=3)
    for y in ys:
        f.draw.line([(xs[0] * SCALE, y * SCALE), (xs[-1] * SCALE, y * SCALE)], fill=0, width=3)
    for (r, c), text in cells.items():
        f.start(xs[c] + 2, ys[r] + 1.5).word(text).end()


def test_boxed_table_with_small_empty_cells(tmp_path):
    f = Form(10.0)
    f.text_line(100, 100, "Weekly sign-off grid")
    f.text_line(100, 125, "Initial each day the line ran")
    side = 12.0
    _grid(f, 100, 160, [60] + [side] * 10, 5, side, {(1, 0): "Mon", (2, 0): "Tue", (3, 0): "Wed"})
    texts, stats = f.run(tmp_path)
    _assert_unmarked(texts, stats, f.lines)
    assert stats["boxes"] == 0


def test_scanned_table_with_ruled_cells_of_text_height(tmp_path):
    f = Form(10.0)
    f.text_line(100, 100, "Sample results")
    _grid(f, 100, 130, [14, 14, 14, 60, 60], 4, 14.0,
          {(0, 0): "A", (0, 1): "B", (0, 2): "C", (0, 3): "Result", (0, 4): "Note",
           (1, 0): "1", (1, 3): "Pass", (2, 1): "2", (2, 3): "Fail", (3, 2): "3", (3, 3): "Pass"})
    texts, stats = f.noisy().run(tmp_path)
    _assert_unmarked(texts, stats, f.lines)


# ---- reading the glyphs OCR made of a box ----

def test_glyph_cuts():
    assert _can_cut("MA", 1)          # ticked box read "M" glued to the label "A"
    assert _can_cut("D/QA", 2)        # box and tick read "D/"
    assert _can_cut("KIR", 2)         # box edge read as "I"
    assert not _can_cut("Fail", 1)    # never inside a Capitalized word
    assert not _can_cut("AB", 2)      # nothing left
    assert _can_tail("destroyedO", 1)  # next box's glyph glued to the word before it
    assert not _can_tail("damaged:", 1)
    assert not _can_tail("labels", 1)
