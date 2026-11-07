"use strict";

const express = require("express");

// This file owns the HTTP contract. The RAG utility remains usable and testable
// without knowing anything about Express.
function createRagRouter({ rag, defaultTopK }) {
  const router = express.Router();

  router.post("/ask", async (request, response, next) => {
    const body = request.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response.status(400).json({ detail: "Request body must be a JSON object" });
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return response.status(400).json({ detail: "question must be a non-empty string" });
    }

    const topK = body.top_k === undefined ? defaultTopK : body.top_k;
    if (!Number.isInteger(topK) || topK < 1 || topK > 10) {
      return response.status(400).json({ detail: "top_k must be an integer between 1 and 10" });
    }

    try {
      return response.json(await rag.ask(question, topK));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createRagRouter };
