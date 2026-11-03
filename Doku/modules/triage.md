# Module: Quick Capture & Triage

Goal: Capture thoughts in seconds and sort them later at peace. Code: [InstantCaptureBar.tsx](../../frontend/src/features/capture/InstantCaptureBar.tsx), [TriageDeck.tsx](../../frontend/src/features/triage/TriageDeck.tsx), backend `handleCaptureInbox`, `handleTriageAction`, and `Store.UpdateThoughtTriage`.

## Capture

- The capture bar is located in the header; `C` or `/` focuses it (unless typing inside an input field).
- Target (`target`): **Inbox** (`inbox`, default), **Direct Task** (`task`, with task list), **List Item** (`list_item`, with target list), or **Direct Note** (`document`). In the expanded area, target and list are selected; saving is triggered with Enter or the submit button. Target and list persist across submissions (per browser tab).
- Multiline input is supported. Voice input uses `useVoiceInput` (Whisper server or browser speech recognition, depending on account settings): With Whisper, the recording streams in chunks for recognition while speaking (`chunked`); browser recognition stops after 5 s of silence. Source `voice` appends the `#diktat` tag.
- Source `webhook` (via API key/webhook) appends the `#webhook` tag. Hashtags in text are extracted as tags (`domain.ExtractTags`).
- Via API: `POST /inbox` and `POST /webhooks/ingest` (see [rest.md](../api/rest.md)).

## Triage Deck

The inbox (`status = inbox`) is processed card by card.

| Action | Desktop | Mobile | Result |
|---|---|---|---|
| Discard | `H` or `←` | Swipe left | `status = discarded` (trash) |
| Convert to Task | `L` or `→` | Swipe right | `kept`/`converted` as task |
| Task with Due Date | `T` | Action menu | Same as above, with due date |
| Convert to Note | `D` | Action menu | New document, thought becomes `converted` (`document`) |
| Later | Space | Action menu | Move card to end of deck |
| Close menu | `Esc` | – | – |

Converting to a note carries over title, completion status, notes, subtasks, as well as due date and priority as indented blocks. Converting to a list item creates an entry in the chosen list and notifies its participants.

## States of a Thought

```
inbox ──keep──▶ kept ──convert──▶ converted (task | document | list_item)
  │                │
  └─discard─▶ discarded ──restore──▶ inbox        (Empty trash: DELETE /thoughts/discarded/purge)
```

Discarded thoughts reside in a dedicated **Triage trash** ([TriageTrash.tsx](../../frontend/src/features/triage/TriageTrash.tsx)): button at the top in Triage, on mobile in the menu. There they can be restored, individually deleted, or permanently cleared all at once. After the retention period configured in Account Settings → Data Retention (default 14 days, counted from discard time, `triaged_at`), the server deletes them automatically.

A thought with `status = kept` already counts as a task and appears in the tasks view.
