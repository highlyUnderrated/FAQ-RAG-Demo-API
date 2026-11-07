"use strict";

require("dotenv").config({ quiet: true });

const path = require("node:path");
const express = require("express");
const OpenAI = require("openai");

const { createRagRouter } = require("./routes/api/rag");
const { Rag } = require("./util/rag");

function readInteger(env, name, fallback, min, max) {
  const value = env[name] ? Number(env[name]) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Keep all adjustable settings in one obvious place. */
function readConfig(env = process.env) {
  if (!(env.OPENAI_API_KEY || "").trim()) throw new Error("OPENAI_API_KEY is not set");

  return {
    apiKey: env.OPENAI_API_KEY.trim(),
    embedModel: env.EMBED_MODEL || "text-embedding-3-small",
    llmModel: env.LLM_MODEL || "gpt-6-luna",
    faqDir: path.resolve(env.FAQ_DIR || path.join(__dirname, "resource", "faqs")),
    chunkSize: readInteger(env, "CHUNK_SIZE", 200, 50, 10_000),
    topKDefault: readInteger(env, "TOP_K_DEFAULT", 4, 1, 10),
    port: readInteger(env, "PORT", 3000, 1, 65_535),
  };
}

/** Build the app separately so API tests never need an API key or paid calls. */
function createApp({ rag, defaultTopK = 4, logger = console }) {
  const app = express();

  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.use(createRagRouter({ rag, defaultTopK }));

  app.use((_request, response) => response.status(404).json({ detail: "Not found" }));
  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && Object.hasOwn(error, "body")) {
      return response.status(400).json({ detail: "Request body contains invalid JSON" });
    }

    logger.error("Unhandled request error", error);
    return response.status(500).json({ detail: "Internal error" });
  });

  return app;
}

/**
 * Initialize every dependency before accepting traffic. If configuration,
 * corpus loading, or embedding fails, the process exits instead of presenting
 * a misleading healthy server with an unusable RAG index.
 */
async function start() {
  const config = readConfig();
  const client = new OpenAI({ apiKey: config.apiKey });

  const rag = new Rag({ client, config });
  await rag.initialize();

  const app = createApp({ rag, defaultTopK: config.topKDefault });

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, "127.0.0.1", () => {
      console.info(`FAQ RAG API listening at http://127.0.0.1:${config.port}`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Unable to start FAQ RAG API: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, readConfig, start };
