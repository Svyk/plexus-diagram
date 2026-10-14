"""Picture classification is on only when the pinned snapshot is cached. No weights, no network."""

from docling.datamodel.base_models import InputFormat

from plexus_parse_helper import models
from plexus_parse_helper.jobs import make_converter


def _patch_converter(monkeypatch, factory):
    import docling.document_converter as dc
    monkeypatch.setattr(dc, "DocumentConverter", factory)


def test_make_converter_enables_classification_when_the_model_is_cached(monkeypatch):
    built = []

    class FakeConverter:
        def __init__(self, format_options):
            self.format_options = format_options
            built.append(format_options[InputFormat.PDF])

    _patch_converter(monkeypatch, FakeConverter)
    monkeypatch.setattr(models, "picture_classifier_ready", lambda hub=None: True)
    make_converter({"ocr": "off", "formula": False, "tables": "fast", "pictures": False})
    pipeline = built[0].pipeline_options
    assert pipeline.do_picture_classification is True
    assert pipeline.picture_classification_options.revision == models.PICTURE_CLASSIFIER_REVISION
    assert pipeline.picture_classification_options.repo_id == models.PICTURE_CLASSIFIER_REPO


def test_make_converter_leaves_classification_off_when_the_model_is_missing(monkeypatch):
    built = []

    class FakeConverter:
        def __init__(self, format_options):
            self.format_options = format_options
            built.append(format_options[InputFormat.PDF])

    _patch_converter(monkeypatch, FakeConverter)
    monkeypatch.setattr(models, "picture_classifier_ready", lambda hub=None: False)
    make_converter({"ocr": "off"})
    assert built[0].pipeline_options.do_picture_classification is False


def test_make_converter_falls_back_when_the_classifier_fails_to_load(monkeypatch):
    flags = []

    class FakeConverter:
        def __init__(self, format_options):
            enabled = format_options[InputFormat.PDF].pipeline_options.do_picture_classification
            flags.append(enabled)
            if enabled:
                raise RuntimeError("weights missing")
            self.format_options = format_options

    _patch_converter(monkeypatch, FakeConverter)
    monkeypatch.setattr(models, "picture_classifier_ready", lambda hub=None: True)
    conv = make_converter({"ocr": "off"})
    assert flags == [True, False]
    assert conv.format_options[InputFormat.PDF].pipeline_options.do_picture_classification is False
