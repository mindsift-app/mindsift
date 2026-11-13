# Performance on 1 CPU Core and 1 GB RAM

Load-tested with v0.95.0 on the public demo, a deliberately small server with **1 CPU core and 1 GB RAM**. Simulated people sign in, open notes and type in them, work with tasks and lists and search, all at the same time, each pausing about 3 seconds between actions:

| People working at once | Typical answer (median) | Slowest 5 % | Errors |
|---|---|---|---|
| 200, about 10 per note | ~0.05 s | ~0.2 s | 0 % |
| 300, about 10 per note | ~0.1–0.3 s | ~0.6–1.1 s | 0 % |
| 500–800, about 10 per note | ~0.6–1.7 s | ~3–7 s | 0 % |
| 1,200, about 10 per note | ~1.8 s | ~6.5 s | 0 % |
| 200, all in the **same** note | ~0.3–1.3 s for an edit | ~2–3 s | 0 % |
| 300, all in the **same** note | ~6 s for an edit | ~7–8 s | 0 % |

- **About 300 people at the same moment** run smoothly on that single core, far more than are usually active at once on an instance of a few hundred accounts.
- **Above that, the CPU is the limit:** everything slows down evenly instead of failing. Even 1,200 people at once, spread over their notes, got no errors. More or faster cores help directly.
- **Many people in one note:** changes to one note are applied one after another so that no edit gets lost, so hundreds typing in one note wait for each other (500 in one note: 10–15 s per edit, still without errors; from 800 on, requests time out). Opening the note stays fast. Why edits to one note are serialized: [modules/collaboration.md](modules/collaboration.md).
- **It recovers by itself:** right after 1,200 people at once, the server answers in under 0.1 s again, without a restart.
- **Compared with the first test** (5 November 2026): with 200 to 300 people 5 to 8 times faster, edits in a shared note 2 to 3 times faster; search, the most expensive request back then, answers in about 0.1 s instead of 1 s.
