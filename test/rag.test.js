"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { Rag, chunkText, cosineSimilarity } = require("../util/rag");

function vectorFor(text) {
  const lower = text.toLowerCase();
  if (lower.includes("password")) return [1, 0, 0];
  if (lower.includes("sso")) return [0, 1, 0];
  return [0.2, 0.2, 0.2];
}

function createFakeClient() {
  const calls = { embeddings: [], responses: [] };
  return {
    calls,
    embeddings: {
      async create(request) {
        calls.embeddings.push(request);
        return {
          data: request.input.map((text, index) => ({ index, embedding: vectorFor(text) })),
        };
      },
    },
    responses: {
      async create(request) {
        calls.responses.push(request);
        return { output_text: "Use the reset link on the login page." };
      },
    },
  };
}

test("text is chunked near the target size at word boundaries", () => {
  const input = "alpha bravo charlie delta echo foxtrot golf hotel";
  assert.deepEqual(chunkText(input, 20), ["alpha bravo charlie", "delta echo foxtrot", "golf hotel"]);
});

test("cosine similarity compares the direction of two vectors", () => {
  assert.ok(Math.abs(cosineSimilarity([3, 4], [6, 8]) - 1) < 1e-10);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("RAG indexes FAQs, retrieves context, and adds deterministic citations", async (context) => {
  const faqDir = await fs.mkdtemp(path.join(os.tmpdir(), "glean-rag-test-"));
  context.after(() => fs.rm(faqDir, { recursive: true, force: true }));

  await fs.writeFile(path.join(faqDir, "faq_auth.md"), "Reset a password with the login-page link.");
  await fs.writeFile(path.join(faqDir, "faq_sso.md"), "Enable SSO by contacting an admin.");

  const client = createFakeClient();
  const rag = new Rag({
    client,
    config: {
      faqDir,
      chunkSize: 200,
      embedModel: "test-embedding-model",
      llmModel: "test-answer-model",
    },
    logger: { info() {} },
  });

  await rag.initialize();
  const result = await rag.ask("Where is the password reset link?", 2);

  assert.deepEqual(result.sources, ["faq_auth.md", "faq_sso.md"]);
  assert.match(result.answer, /\[faq_auth\.md\]/);
  assert.match(result.answer, /\[faq_sso\.md\]/);
  assert.equal(client.calls.embeddings.length, 2);
  assert.match(client.calls.responses[0].input, /SOURCE 1: faq_auth\.md/);
});

test("RAG refuses searches before its index is initialized", async () => {
  const rag = new Rag({ client: createFakeClient(), config: {} });
  await assert.rejects(() => rag.search("hello", 1), /not initialized/);
});
