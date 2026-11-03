# Echtzeit: WebSocket, SSE und Long-Polling

Der Server verteilt Änderungen als JSON-Ereignisse an verbundene Clients. Die Ereignisse entstehen **nach** einer REST-Änderung; es gibt keinen Schreibkanal über die Verbindung. Implementierung: [hub.go](../../internal/ws/hub.go), Client: [realtime.ts](../../frontend/src/lib/api/realtime.ts).

> Keine CRDTs, keine Sperren, keine Cursor-Presence. Frühere Fassungen dieser Doku beschrieben DocRooms, `clientId`-Echo-Schutz und Yjs; das existiert nicht (mehr).

## Transporte

| Transport | Endpunkt | Hinweise |
|---|---|---|
| WebSocket | `GET /api/v1/ws` (auch `/ws/lists/{id}`, `/ws/spaces/{id}`) | Ping alle 30 s, Lesefrist 60 s, Nachrichten bis 4 MB |
| SSE | `GET /api/v1/events` | Kommentar-Ping alle 15 s, Header `X-Accel-Buffering: no` |
| Long-Polling | `POST /api/v1/events/poll` → `{pollId}`, dann `GET /api/v1/events/poll/{pollId}?wait=25` | Antwort `{events: [...]}`, sobald Ereignisse da sind, spätestens nach `wait` s leer; `404` = abgelaufen, neu öffnen |

Der Client versucht zuerst WebSocket und wechselt in folgenden Fällen für die Sitzung des Tabs auf SSE:

- Aufbau gelingt nicht innerhalb von 2,5 s, oder die Verbindung bricht unsauber ab (z. B. Code 1006/1008).
- **Herzschlag:** Alle 15 s schickt der Client `{"event":"PING"}`, der Server antwortet `PONG`. Kommt 35 s lang keine Nachricht, gilt der WebSocket als stumm (Proxy nimmt das Upgrade an, leitet aber nichts weiter).

Über SSE liefert der Server zuerst `SSE_CONNECTED` mit einer `sseId`; erst dann gilt SSE als verbunden. Bleibt dieses erste Ereignis 5 s nach dem Öffnen aus, puffert ein Proxy den Stream: SSE wird für den Tab abgeschaltet. Räume werden über `POST /api/v1/events/rooms` (`sseId`, `room`, `action`: `join`/`leave`) abonniert.

Ohne WebSocket und SSE holt der Client die Ereignisse per **Long-Polling**: Er öffnet eine Poll-Verbindung (Räume als `rooms` gleich mitgeben oder später wie bei SSE über `POST /events/rooms` mit der `pollId` als `sseId`), der Server puffert ihre Ereignisse (bis 256), und jede Abfrage wartet bis zu 25 s. Wird eine Poll-Verbindung 2 Minuten nicht abgefragt, schließt der Server sie. Nur mit Sitzung, nicht mit API-Schlüssel. So kommen auch Aufgaben- und Listenänderungen hinter Proxys live an. Die Notiz-Synchronisation nutzt dann dieselbe Verbindung als Weckruf; ohne sie fällt sie auf ihr eigenes Long-Polling (`GET /docs/{id}/changes`) und zuletzt auf eine Abfrage alle 3 s zurück (siehe [modules/collaboration.md](../modules/collaboration.md)).

**Authentifizierung:** Browser holen sich direkt vor dem Verbinden ein Einmal-Ticket (`POST /auth/stream-ticket` mit dem normalen `Authorization`-Header → `{ticket, expiresIn: 60}`) und hängen es als `?ticket=` an; es gilt 60 Sekunden und einmal und wird ungültig, sobald alle Sitzungen beendet werden. Andere Clients dürfen stattdessen den `Authorization`-Header schicken. Sitzungs-Tokens in der URL und API-Keys werden nicht angenommen (`401`). Bei Logout, „Alle Sitzungen beenden“, neuem Passwort und Deaktivierung trennt der Server alle Streams des Kontos; Clients mit gültiger Sitzung verbinden sich mit neuem Ticket neu. Mit gesetzter `BASE_URL` nimmt der WebSocket nur Verbindungen von dieser Adresse oder vom angefragten Host an.

**Räume:** Jeder Beitritt (Raum in der URL, `JOIN_ROOM`, SSE-Startparameter `rooms`/`docId`, `POST /events/rooms`) wird geprüft: `doc:<id>` nur mit Lesezugriff auf die Notiz, sonst muss die ID eine lesbare geteilte Liste sein. Nicht erlaubte Räume werden ignoriert, `POST /events/rooms` antwortet dann mit `403`. SSE-Räume kann nur der Besitzer der jeweiligen `sseId` ändern.

## Nachrichtenformat

```json
{ "event": "TASK_UPDATED", "listId": "", "payload": { … }, "timestamp": "2026-10-27T12:00:00Z" }
```

Client → Server versteht der Server nur: `{"event":"JOIN_ROOM","room":"<id>"}`, `{"event":"LEAVE_ROOM","room":"<id>"}` und `{"event":"PING"}` (Antwort `PONG`). Räume heißen `doc:<docId>` für Notizen oder `<listId>` für geteilte Listen.

## Zustellung

| Kanal | Wer erhält es |
|---|---|
| Benutzer-Kanal (`BroadcastToUser`) | alle Verbindungen eines Benutzers |
| Raum (`BroadcastRoom`, `Broadcast`) | Verbindungen im Raum |
| Mehrere Benutzer (`BroadcastToUsers`) | alle Verbindungen einer berechneten Benutzergruppe, z. B. Eigentümer und Mitglieder einer Aufgabenliste |

## Ereignisse

| Ereignis | Auslöser | Kanal |
|---|---|---|
| `TASK_CREATED` | `POST /inbox`, Webhook | Eigentümer und Benutzer der Liste |
| `TASK_UPDATED` | `PATCH /thoughts/{id}`, Triage | Eigentümer und Benutzer der alten und neuen Liste |
| `TASK_DELETED` | `DELETE /thoughts/{id}` | Eigentümer und Benutzer der Liste |
| `TASK_REORDERED` | Aufgaben umsortieren | Benutzer aller betroffenen Listen |
| `TASK_LIST_UPDATED` / `TASK_LIST_DELETED` | Liste ändern, (un)teilen, löschen; Payload nur `{id}`, Clients laden ihre Listen neu | Benutzer vor und nach der Änderung |
| `DOC_CREATED`, `DOC_UPDATED`, `DOC_DELETED` | Notiz anlegen/ändern/löschen, Freigaben | berechtigte Benutzer |
| `DOC_SEQ` | Änderung an Notiz, Leases oder Präsenz (`docId`, `headSeq`); Clients holen die Daten per `/docs/{id}/sync` | Raum `doc:<id>` |
| `WORKSPACE_FOLDERS_UPDATED` | Ordner/Mounts ändern | Benutzer selbst; bei geteilten Ordnern Eigentümer und alle Beteiligten |
| `LIST_CREATED`, `LIST_UPDATED`, `LIST_DELETED`, `LIST_SHARED`, `LIST_UNSHARED`, `LIST_CLEARED` | Listenverwaltung | Benutzer bzw. Raum der Liste |
| `ITEM_CREATED`, `ITEM_UPDATED`, `ITEM_TOGGLED`, `ITEM_DELETED`, `ITEM_REORDERED` | Listeneinträge | Raum der Liste |
| `USER_PRESENCE` | Verbindung auf-/abgebaut (`onlineCount`) | Raum |
| `DEMO_RESET` | Periodischer Reset im Demo-Modus; Clients verwerfen lokale Caches und laden Daten neu | Alle aktiven Verbindungen |
| `SSE_CONNECTED` | Nur SSE, direkt nach Verbindung | Verbindung |

## Verhalten im Frontend

- Die globale Verbindung (ein Singleton) leitet jede Nachricht als Browser-Ereignis `mindsift:ws` weiter; Ansichten (`TasksView`, `WorkspaceView`, `SharedListsView`) hören darauf und laden bzw. patchen ihren Zustand.
- Nach einem Abbruch verbindet sich der Client mit Verzögerung neu.
- Notiz-Inhalte kommen nie per Push, sondern immer über `POST /docs/{id}/sync`; `DOC_SEQ` ist nur der Weckruf. Konflikte entscheidet der Server (Versionen und Sperren, siehe [modules/collaboration.md](../modules/collaboration.md)).
