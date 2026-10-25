"""Sentence embedding for the semantic cache.

Model is loaded once at import — never per call.

Runs all-MiniLM-L6-v2 through fastembed (ONNX Runtime) rather than
sentence-transformers: same model, same 384-dim output, but no torch — roughly
150MB resident instead of 500MB+, which is what lets the API fit a 512MB
free-tier instance. Vectors are L2-normalized here so cosine search over
existing pgvector rows is unaffected.
"""
from __future__ import annotations

import os

import numpy as np
from fastembed import TextEmbedding

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# Loaded once at module init. FASTEMBED_CACHE_PATH lets the Docker image bake
# the model in at build time instead of downloading it on every cold start.
_model = TextEmbedding(MODEL_NAME, cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))


def _validate(text: str) -> None:
    if text is None or not text.strip():
        raise ValueError("cannot embed empty or whitespace-only text")


def _normalize(vec: np.ndarray) -> list[float]:
    norm = np.linalg.norm(vec)
    return (vec / norm if norm else vec).tolist()


def embed(text: str) -> list[float]:
    _validate(text)
    return _normalize(next(iter(_model.embed([text]))))


def embed_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        raise ValueError("cannot embed an empty batch")
    for t in texts:
        _validate(t)
    return [_normalize(v) for v in _model.embed(texts)]
