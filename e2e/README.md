# Ende-zu-Ende-Tests

Browser-Tests mit Playwright gegen einen echten MindSift-Server.

```bash
e2e/run.sh            # baut das Image, startet es im Demo-Modus und führt die Tests aus
ENGINE=docker e2e/run.sh
```

Gegen einen bereits laufenden Server (Demo-Modus mit `admin/admin` und `user/user` nötig):

```bash
cd e2e && npm install && MINDSIFT_URL=http://localhost:8080 node collab.e2e.mjs
```

## collab.e2e.mjs

Zwei Browser (Eigentümer und Bearbeiter) arbeiten in derselben Notiz. Geprüft wird:

- Tippen wird gespeichert und erscheint beim anderen ohne Neuladen
- neue Bullets per Enter, in beide Richtungen
- Offline-Phase: Text bleibt lokal und wird nach Rückkehr übertragen
- beide Browser und der Server zeigen denselben Stand, auch nach Neuladen
- Sperren eines geschlossenen Browsers laufen nach spätestens 20 s ab
- Einrücken (Tab) und Zusammenführen (Backspace) bleiben nach Neuladen erhalten

## share.e2e.mjs

Der Eigentümer teilt eine Notiz über den Freigabe-Dialog mit Rolle „Bearbeiten“; geprüft wird, dass die Freigabe als `write` gespeichert, im Dialog als „Bearbeiter“ angezeigt wird und der Empfänger die Notiz bearbeiten kann. Zum Schluss hakt der Eigentümer ein To-Do in der To-Do-Übersicht ab.

## lock.e2e.mjs

Sperren, Präsenz, Rückgängig und Konfliktkopien mit zwei Browsern: Schloss und Schreibschutz am fremd bearbeiteten Bullet, Hinweis statt halb ausgeführter Aktion, `Strg+Z`/`Strg+Umschalt+Z`, Tippen direkt nach Enter, Markierung von Konfliktkopien sowie „Übernehmen“ (verweigert bei fremder Sperre, erfolgreich für den Sperrinhaber).

## channels.e2e.mjs

Der Eigentümer tippt mit normaler Verbindung, der Bearbeiter sitzt hinter einem simulierten Proxy. Für jede Situation wird der gewählte Weg und die Zeit bis zur Anzeige gemessen: nichts blockiert (WebSocket), WebSocket abgelehnt (SSE), WebSocket angenommen aber stumm (SSE nach Herzschlag-Ausfall), WebSocket und SSE blockiert sowie SSE hängend (Long-Polling), nur normale Anfragen (Abfrage alle 3 s).

`collab.e2e.mjs`, `lock.e2e.mjs` und `channels.e2e.mjs` dauern je etwa eine Minute. Die Tests laufen nicht in der CI, weil sie Browser-Images brauchen.

## Screenshots

`e2e/screenshots.sh` baut das Image, startet es im Demo-Modus mit frischer Datenbank und erzeugt die Bilder in `screenshots/` neu (`screenshots.mjs`). Danach werden sie verkleinert (Desktop 1280 px, Handy 480 px breit) und als WebP mit Qualität 90 gespeichert (`cwebp` in einem Alpine-Container). Für die Versionsangabe im Kopf: `APP_VERSION=v0.2 e2e/screenshots.sh`. In der Workspace-Aufnahme bearbeitet der Demo-Benutzer `user` gleichzeitig einen Bullet, damit Sperre und Präsenz zu sehen sind.
