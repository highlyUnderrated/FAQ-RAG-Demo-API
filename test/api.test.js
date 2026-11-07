"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { createApp, readConfig } = require("../server");

async function startTestServer(rag) {
  const logger = { info() {}, error() {} };
  const server = http.createServer(createApp({ rag, defaultTopK: 4, logger }));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function createStubRag() {
  return {
    async ask(question, topK) {
      return {
        answer: `Answer for ${question} with top ${topK}`,
        sources: ["faq_auth.md", "faq_sso.md"],
      };
    },
  };
}

test("GET /health returns the exact health contract", async (context) => {
  const server = await startTestServer(createStubRag());
  context.after(server.close);

  const response = await fetch(`${server.baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("POST /ask returns only answer and sources", async (context) => {
  const server = await startTestServer(createStubRag());
  context.after(server.close);

  const response = await fetch(`${server.baseUrl}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How do I reset my password?", top_k: 2 }),
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body), ["answer", "sources"]);
  assert.deepEqual(body, {
    answer: "Answer for How do I reset my password? with top 2",
    sources: ["faq_auth.md", "faq_sso.md"],
  });
});

test("POST /ask rejects bad inputs with status 400", async (context) => {
  const server = await startTestServer(createStubRag());
  context.after(server.close);

  const badBodies = [
    {},
    { question: "   " },
    { question: "valid", top_k: 0 },
    { question: "valid", top_k: 11 },
    { question: "valid", top_k: 1.5 },
  ];

  for (const body of badBodies) {
    const response = await fetch(`${server.baseUrl}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, `Expected 400 for ${JSON.stringify(body)}`);
  }
});

test("POST /ask converts unexpected service failures to a safe 500", async (context) => {
  const rag = createStubRag();
  rag.ask = async () => {
    throw new Error("sensitive upstream detail");
  };
  const server = await startTestServer(rag);
  context.after(server.close);

  const response = await fetch(`${server.baseUrl}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "A valid question" }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { detail: "Internal error" });
});

test("POST /ask treats malformed JSON as a bad request", async (context) => {
  const server = await startTestServer(createStubRag());
  context.after(server.close);

  const response = await fetch(`${server.baseUrl}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-valid-json",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { detail: "Request body contains invalid JSON" });
});

test("configuration requires an API key and validates top_k", () => {
  assert.throws(() => readConfig({}), /OPENAI_API_KEY is not set/);
  const config = readConfig({ OPENAI_API_KEY: "test-key" });
  assert.equal(config.topKDefault, 4);
  assert.equal(config.port, 3000);
  assert.throws(
    () => readConfig({ OPENAI_API_KEY: "test-key", TOP_K_DEFAULT: "11" }),
    /between 1 and 10/,
  );
});
