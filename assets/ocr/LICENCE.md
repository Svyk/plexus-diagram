# OCR model licence

The weights in this folder are PP-OCRv5 mobile detection (`ch_PP-OCRv5_det_mobile.onnx`) and English recognition (`en_PP-OCRv5_rec_mobile.onnx`), with the English character list `ppocrv5_en_dict.txt`.

- Licence: Apache-2.0
- Upstream: PaddleOCR PP-OCRv5, redistributed by RapidAI RapidOCR v3.9.2
- Detection: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx
- Recognition: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx
- Dictionary: https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile/ppocrv5_en_dict.txt

The browser runtime is onnxruntime-web 1.30.0 (MIT), loaded from jsDelivr only after the user starts a scan. SHA-256 values for the weights and the runtime files are in `src/model/ocr/manifest.js`. Nothing in this folder is fetched when the extension loads.
