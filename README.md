# Prompt Cache Forecast

Eine Claude-Code-Mod, die über dem Prompt zwei Zeilen zeigt: wie voll das Kontextfenster ist (wie [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather)) und wie viele Tokens gerade im Prompt-Cache liegen und wann er abläuft.

```text
 ☂  Schauer  67% bis Auto-Compact  335.2k / 500k   letzte Turns ▁▂█  ▲ +98.3k letzter Turn
 ◆ Cache  132.1k Tokens  ███████░░░  läuft ab in 42:12  · TTL 1h  · zuletzt 120k gelesen, 12.1k geschrieben
```

Ist der Cache abgelaufen:

```text
 ◇ Cache kalt  132.1k Tokens, abgelaufen vor 3 min  · der nächste Request schreibt sie neu · TTL 1h
```

## Warum der Name

- **Prompt Cache** ist der Fachbegriff für das, was die Mod misst: das Prompt-Caching der Claude-API. „Cache“ allein könnte jeder Cache sein.
- **Forecast** sagt, was die Mod tut: Sie sagt voraus, wann der Cache abläuft. Gleichzeitig bleibt das Wetterbild von token-weather erkennbar, auf dem die Mod aufbaut und dessen Kontext-Vorhersage sie in der ersten Zeile weiter zeigt.

## Installation

In einer Claude-Code-Session im Terminal:

```
/plugin install prompt-cache-forecast --marketplace DominikvD/prompt-cache-forecast
```

`y` bestätigt den Marketplace, danach den Scope wählen (User-Scope gilt für alle Sessions).

Zum Ausprobieren aus einem lokalen Klon:

```bash
claude --plugin-dir ./prompt-cache-forecast
```

## So rechnet die Mod

- **Tokens im Cache:** Nach jedem Request des Haupt-Chats liest die Mod dessen Verbrauch. Aus dem Cache gelesene plus neu geschriebene Tokens ergeben, was jetzt im Cache liegt.
- **Ablauf:** Zeitpunkt des letzten Requests plus TTL; jeder Treffer startet die Frist neu. Der Server meldet den Ablauf nicht, deshalb rechnet die Mod ihn aus und zählt jede Sekunde herunter. Der Balken leert sich und wechselt von grün über gelb nach rot.
- **Vorwarnung:** `warnSeconds` (Standard 60) Sekunden vor Ablauf kommt ein Toast, wenn Claude gerade nicht arbeitet.
- **Kontext:** wie token-weather nach jedem Turn, aber gemessen am Limit, das wirklich gilt: Ist ein Auto-Compact-Fenster gesetzt (`autoCompactWindow` in den Settings oder `CLAUDE_CODE_AUTO_COMPACT_WINDOW`) und kleiner als das Fenster des Modells, rechnet die Mod damit und schreibt „bis Auto-Compact“ statt „Kontext“. Ohne ein solches Fenster zählt das volle Modellfenster. Den Wert liest sie aus der Kontext-Aufschlüsselung, wie `/context` sie zeigt; dafür wird keine Anfrage gesendet.

## Einstellungen

| Feld | Werte | Standard | Bedeutung |
| --- | --- | --- | --- |
| `ttl` | `1h`, `5m`, `auto` | `1h` | Lebensdauer des Caches. `auto` beginnt bei 5m und stellt auf 1h um, sobald ein Cache-Treffer nach mehr als 5 Minuten Pause das belegt; auch Modellwechsel und fortgesetzte Sessions werden ausgewertet. |
| `warnSeconds` | Zahl | `60` | Vorwarnung in Sekunden; `0` schaltet sie ab. |

Gesetzt werden sie im Config-Menü oder in `settings.json` unter `pluginConfigs["prompt-cache-forecast"].options`.

## Grenzen

- Gezählt wird nur der Cache des Haupt-Chats; Subagents haben eigene Caches.
- Läuft ein einzelnes Tool länger als die TTL, kann der Cache mitten im Turn ablaufen; die Anzeige zeigt das korrekt.
- Bei einer fortgesetzten Session ist der erste Wert eine Schätzung (`~`), bis der erste echte Request kommt.
- Eine Mod pro Band: token-weather und prompt-cache-forecast belegen dieselbe Zeile über dem Prompt. prompt-cache-forecast enthält die Wetterzeile bereits, token-weather also deaktivieren.
- Angezeigt wird im Terminal und in der Desktop-App.

## Entwicklung

```bash
claude plugin validate .
claude plugin test .
```

Die Typen legt Claude Code beim Laden selbst unter `.claude-plugin/types/` ab (nicht versioniert); `tsconfig.json` verweist darauf.

## Herkunft

Die Kontextzeile (Wettersymbole, Verlaufsdiagramm, Zahlenformat) ist aus [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) übernommen und angepasst: Copyright 2026 Anthropic PBC, lizenziert unter Apache-2.0.

## Lizenz

Apache-2.0, siehe [LICENSE](LICENSE).
