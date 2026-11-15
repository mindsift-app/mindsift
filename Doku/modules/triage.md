# Module: Quick Capture & Triage

Goal: Capture thoughts in seconds and sort them later at peace. Code: [InstantCaptureBar.tsx](../../frontend/src/features/capture/InstantCaptureBar.tsx), [TriageDeck.tsx](../../frontend/src/features/triage/TriageDeck.tsx), backend `handleCaptureInbox`, `handleTriageAction`, and `Store.UpdateThoughtTriage`.

## Capture

- **Desktop:** the capture bar lives in the **Quick Dump** window ([QuickDumpWindow.tsx](../../frontend/src/app/QuickDumpWindow.tsx)), which opens at the top centre over the dimmed page. It opens with `C` (not while typing in a field, not with Ctrl/Cmd, not while another dialog is open) or the + in the navigation rail. It stays mounted while closed, so target and unfinished text survive; after sending it stays open for the next thought, Escape or a click beside it closes it (saving a Direct Note closes it and opens the note). `/` opens the command palette, not the capture bar.
- **Phone:** the + in the bottom bar opens the Quick Dump sheet; holding the + dictates straight into the inbox.
- Target (`target`): **Inbox** (`inbox`, default), **Direct Task** (`task`, with task list), **List Item** (`list_item`, with target list), or **Direct Note** (`document`). In the expanded area, target and list are selected; saving is triggered with Enter or the submit button. Target and list persist across submissions (per browser tab).
- Multiline input is supported. Voice input uses `useVoiceInput` (Whisper server or browser speech recognition, depending on account settings): With Whisper, the recording streams in chunks for recognition while speaking (`chunked`); browser recognition stops after 5 s of silence. Captures made with dictation are sent with source `voice`; the server then adds the tag `#diktat` ([thoughts.go](../../internal/storage/thoughts.go), only if not already present), and the inbox list shows a "Dictation" badge with a microphone.
- Source `webhook` (via API key/webhook) appends the `#webhook` tag. Hashtags in text are extracted as tags (`domain.ExtractTags`).
- Via API: `POST /inbox` and `POST /webhooks/ingest` (see [rest.md](../api/rest.md)).
- **Dates in the text** ([naturalDate.ts](../../frontend/src/lib/naturalDate.ts), [NaturalDateHint.tsx](../../frontend/src/components/NaturalDateHint.tsx)): for the targets Inbox and Direct Task, a due date written into the text ("Zahnarzt morgen 14 Uhr", "Dentist tomorrow 2pm") is recognised while typing, rule based and without AI, in the language of the app (German and English fully; French, Italian, Spanish the basic forms). The phrase is marked in the field (an overlay with the field's metrics) and a chip shows the date (`formatDue`) with an × to ignore it. On saving the phrase, with joining words such as "am"/"um", leaves the title and the due date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, local calendar day like all due dates in the frontend) is sent with the capture; the text only changes while the chip is visible. A date picked in the date field wins (no chip then). Recognised: today/tomorrow/day after tomorrow, weekdays (the next one; today's weekday means next week; "next Tuesday" is the same day as "Tuesday"), "in 3 days/weeks/months", "24.12.", "24.12.2026", "24. Dezember", "Dec 24", ISO dates, times ("14 Uhr", "um 9", "14:30", "2pm", "at 9" = 09:00, "14h", "alle 14", "a las 14"), and a day with a time anywhere in the text. A time alone means today if still ahead, otherwise tomorrow. Not taken: bare numbers, "um" without a number, "24.12" without the closing dot, "1/2", "Morgen" after "Guten"/"am"/"heute", month names without a day ("Mai"). The same applies to the phone Quick Dump sheet and to new tasks in the tasks view; holding the + to dictate saves at once without a chip, so no date is read there.

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
