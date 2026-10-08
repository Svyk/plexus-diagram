// Session wrappers around an already-imported onnxruntime-web. This file does not import it.
// The caller sets env.wasm.wasmPaths and numThreads before createOrtRunners.

async function openSession(ort, buffer) {
  try {
    return await ort.InferenceSession.create(buffer, { executionProviders: ["webgpu", "wasm"] });
  } catch {
    return await ort.InferenceSession.create(buffer, { executionProviders: ["wasm"] });
  }
}

export async function createOrtRunners(ort, detBuffer, recBuffer) {
  const det = await openSession(ort, detBuffer);
  const rec = await openSession(ort, recBuffer);
  return {
    async runDet(data, dims) {
      const out = await det.run({ x: new ort.Tensor("float32", data, dims) });
      return out.fetch_name_0.data;
    },
    async runRec(data, dims) {
      const out = await rec.run({ x: new ort.Tensor("float32", data, dims) });
      const tensor = out.fetch_name_0;
      return { logits: tensor.data, batch: tensor.dims[0], time: tensor.dims[1], classes: tensor.dims[2] };
    },
  };
}
