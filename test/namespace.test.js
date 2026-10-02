import test from "node:test";
import assert from "node:assert/strict";
import { dropNamespace, namespaceParent } from "../src/model/namespace.js";

test("RG-9: a namespaced page title yields its parent", () => {
  assert.equal(namespaceParent("Project/Sub"), "Project");
  assert.equal(namespaceParent("Project/Sub/Leaf"), "Project");
  assert.equal(namespaceParent("  Project/Sub  "), "Project");
  assert.equal(namespaceParent("Project"), null);
  assert.equal(namespaceParent("/Sub"), null);
  assert.equal(namespaceParent("Project/"), null);
  assert.equal(namespaceParent(""), null);
  assert.equal(namespaceParent(null), null);
});

test("RG-9: a drop offers one parent, and only for the namespaced pages", () => {
  assert.deepEqual(dropNamespace(["[[Project/Sub]]"]), { parent: "Project", indexes: [0] });
  assert.deepEqual(
    dropNamespace(["[[Project/Sub]]", "a note", "[[Project/Other]]"]),
    { parent: "Project", indexes: [0, 2] },
  );
  assert.equal(dropNamespace(["[[Plain]]"]), null);
  assert.equal(dropNamespace(["((abcdefgh1))"]), null);
  assert.equal(dropNamespace(["[[Project/Sub]]", "[[Other/Page]]"]), null);
  assert.equal(dropNamespace([]), null);
});
