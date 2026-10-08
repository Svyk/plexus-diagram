# OCR model licence

The weights in this folder are PP-OCRv5 mobile detection (`ch_PP-OCRv5_det_mobile.onnx`) and English recognition (`en_PP-OCRv5_rec_mobile.onnx`), with the English character list `ppocrv5_en_dict.txt`.

- Licence: Apache-2.0
- Upstream: PaddleOCR PP-OCRv5, redistributed by RapidAI RapidOCR v3.9.2
- Detection: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx
- Recognition: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx
- Dictionary: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile/ppocrv5_en_dict.txt

The browser runtime is onnxruntime-web 1.30.0 (MIT), loaded from jsDelivr only after the user starts a scan. SHA-256 values for the weights and the runtime files are in `src/model/ocr/manifest.js`. Nothing in this folder is fetched when the extension loads.

## Word list

`en-words.txt.gz` is the lowercase alphabetic words of SCOWL 2020.12.07 (Spell Checker Oriented Word Lists, english + american, sizes 10 to 40), one per line, gzip. The OCR text-line pass uses it to correct letters the recogniser confused. It is fetched with the models (or on the first in-browser read once the models are cached), SHA-256 checked against `LEXICON_FILE` in `src/model/ocr/manifest.js`, and kept in Cache Storage.

Copyright 2000-2018 by Kevin Atkinson

Permission to use, copy, modify, distribute and sell these word lists, the associated scripts, the output created from the scripts, and its documentation for any purpose is hereby granted without fee, provided that the above copyright notice appears in all copies and that both that copyright notice and this permission notice appear in supporting documentation. Kevin Atkinson makes no representations about the suitability of this array for any purpose. It is provided "as is" without express or implied warranty.
