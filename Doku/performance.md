# Performance on 1 CPU Core and 1 GB RAM

Load-tested on 14 November 2026 with the code of the next release on the public demo, a deliberately small server with **1 CPU core and 1 GB RAM**. Simulated people sign in, open notes and type in them, load their note list, work with tasks and lists and search, all at the same time, each pausing about 3 seconds between actions. Each person has a workspace of realistic size, so the note list and search do real work:

| People working at once | Typical answer (median) | Slowest 5 % | Errors | Memory of the server |
|---|---|---|---|---|
| 500, about 10 per note | ~1.1 s | ~3 s | 0 % | ~70 MB |
| 800, about 10 per note | ~3 s | ~13 s | 0.02 % | ~95 MB |
| 1,200, about 10 per note | ~8 s | ~16 s | 0.03 % | ~200 MB |
| 300, all in the **same** note | ~0.5 s | ~4 s | 0 % | |
| 500 with their own task lists (400 tasks each) | ~4 s | ~10 s | 0.2 % | ~120 MB |
| 100 in **one** shared task list (Kanban moves, edits, ticks) | ~3 s | ~9 s | no time-outs | ~140 MB |

- **Several hundred people at the same moment** work on that single core, far more than are usually active at once on an instance of a few hundred accounts.
- **Above that, the CPU is the limit:** everything slows down evenly. At 1,200 people at once the core is full and hardly any request runs into the 30-second limit (0.03 %); the note list, which used to time out first, stays at a few seconds. Memory stays low throughout (the note list is sent without the bullets, and the server keeps itself below the container's memory limit). More or faster cores help directly.
- **Many people in one note:** changes to one note are applied one after another so that no edit gets lost, so hundreds typing in one note wait for each other. Opening the note stays fast. Why edits to one note are serialized: [modules/collaboration.md](modules/collaboration.md).
- **It recovers by itself:** right after 1,200 people at once, the server answers in under 0.3 s again, without a restart.
- **Compared with the test of v0.95.0:** that test used small workspaces, so the note list and search hardly cost anything. With realistic workspaces, the note list of that version used several hundred MB under load and search requests timed out from 800 people on; the next release sends the note list without bullets (about a hundredth of the size) and searches only what the person can see.
