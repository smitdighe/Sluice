"""Load scenarios for /v1/chat.

Prompts are real text that flows through app/core/router/classifier.py — the
categories are produced by the classifier, never synthetic labels. Distribution
roughly mirrors expected traffic: mostly simple, some complex, a few bulk.

Run (headless), examples:
  # baseline
  locust -f chaos/locustfile.py --headless -u 20 -r 5 -t 60s --host http://127.0.0.1:8099
  # burst
  locust -f chaos/locustfile.py --headless -u 100 -r 100 -t 30s --host http://127.0.0.1:8099

Percentiles (p50/p95/p99) and error rate come from locust's own stats output.
For a partial-outage run, enable chaos faults on 1-2 providers first (see
tests/integration or scripts that call app.chaos.fault_injection.set_fault).
"""
from __future__ import annotations

import random

from locust import HttpUser, between, task

SIMPLE = [
    "What is the capital of France?",
    "What is 2 + 2?",
    "Who wrote Hamlet?",
    "Name the largest planet.",
    "What year did World War II end?",
]
COMPLEX = [
    "Explain the CAP theorem in detail with a real system example.",
    "Compare optimistic vs pessimistic locking and when to use each.",
    "Explain step by step how a TLS handshake establishes a session key.",
    "Describe how a generational garbage collector works and why.",
]
BULK = [
    "Classify the following 3 reviews as positive or negative: 'Loved it'; 'Awful'; 'Fine'.",
    "Translate these 3 words to Spanish: cat, dog, house.",
    "Summarize each of the following 2 tickets in one sentence.",
]


class SluiceUser(HttpUser):
    wait_time = between(0.1, 0.5)

    def _post(self, prompt: str, name: str) -> None:
        with self.client.post(
            "/v1/chat", json={"prompt": prompt}, name=name, catch_response=True
        ) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"status {resp.status_code}")

    @task(60)
    def simple(self) -> None:
        self._post(random.choice(SIMPLE), "chat[simple]")

    @task(25)
    def complex(self) -> None:
        self._post(random.choice(COMPLEX), "chat[complex]")

    @task(15)
    def bulk(self) -> None:
        self._post(random.choice(BULK), "chat[bulk]")
