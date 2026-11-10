# Claude Switcher su Windows — design

Data: 2026-11-10. Richiesta del team che usa il fork: «deve fare esattamente le cose che fa per Mac ma su Windows». Prima per noi, in un fork; se va bene, si valuta di proporlo a monte.

## Perché

Il team usa bb anche su un PC Windows (bb 0.49, Claude Code installato via npm). Sul Mac claude-switcher distribuisce i progetti fra più account Claude Code; su Windows il plugin si installa e parte, ma non legge nessun account: `accountsDir` viene rifiutato («must be an absolute path») perché il controllo accetta solo percorsi che iniziano con `/`. Oggi è installato e **disabilitato** su quel PC.

## Obiettivo

Parità di funzioni con macOS/Linux quando il server bb (dove gira il plugin) è Windows:

- scoperta degli account (`accountsDir` e account di default `~/.claude` + `~/.claude.json`);
- lettura e rinnovo delle credenziali OAuth, lettura dell'uso (5 h, settimanale, modelli);
- tutta la logica di reparto (posti, cambio automatico, B2–B5, marche di limite e di sessione, storico, `rebalance`, `health`, `use`, `reserve`…) **invariata**;
- login di un account nuovo da bb, con finestra privata di Chrome come sul Mac;
- condivisione delle sessioni fra account (`projects/`, e le voci `SHARED` di una cartella account nuova), così che `claude --resume` trovi la conversazione dopo uno spostamento;
- stessi comandi CLI, stesso pannello, stesse impostazioni (cambia solo il testo dell'impostazione Chrome: «on macOS» → «on macOS and Windows»).

## Non obiettivi

- Nessun cambiamento alle regole di reparto, ai valori di default o al comportamento su macOS/Linux. Ogni modifica è dietro il ramo di piattaforma o è neutra per i percorsi POSIX (i test esistenti devono restare verdi senza ritocchi alle aspettative).
- Gli script esterni al plugin (`scripts/canario-cola.mjs`, `scripts/tic-team.mjs`, `scripts/*.py`, `bin/login-remoto.sh` se esiste) restano come sono: girano come automazioni sul server del team originale.
- Nessuna CI Windows obbligatoria a monte (il fork può aggiungere un job `windows-latest` per i test; `bb-app` da npm non si installa su Windows, quindi il build `dist/` resta sul job Linux).
- Un server bb Windows che comanda macchine remote Mac/Linux (marca per macchina ecc.): deve continuare a funzionare come oggi, ma non è un caso da collaudare ora.

## Anti-obiettivi (fallimento anche se «funziona»)

- Rompere o cambiare anche di poco il comportamento sul Mac/Linux.
- Scrivere credenziali in chiaro altrove che in `<configDir>\.credentials.json` (dove le scrive già Claude Code su Windows) o loggarle.
- Richiedere privilegi di amministratore o la Modalità sviluppatore di Windows.
- Perdere conversazioni: la condivisione delle sessioni non deve mai cancellare né sovrascrivere (regola già esistente).

## Dove si rompe oggi e cosa cambia

1. **Percorsi** (`src/accounts.ts`, `server.ts` `plainPath`, concatenazioni `${dir}/${name}`).
   - `expandHome` accetta anche `~\`; `normalizeDir` toglie anche `\` finali; il controllo «assoluto» usa la regola di piattaforma (`C:\…`, `C:/…`, `\\server\share\…` su Windows).
   - `plainPath` (confronto di dove portano due percorsi, già case-insensitive) tratta `\` come separatore e conserva la lettera di unità.
   - Le concatenazioni con `/` funzionano già con le API `fs` di Node su Windows; ma il valore scritto in `CLAUDE_CONFIG_DIR` e la chiave di confronto delle cartelle account devono essere **uno solo e stabile** (vedi «Decisioni lasciate al builder»).
2. **Credenziali** (`src/credentials.ts`). Il ramo non-darwin (file `.credentials.json` nella cartella dell'account; default `~/.claude/.credentials.json`) è già quello che Claude Code usa su Windows: verificato sul PC (`C:\Users\<utente>\.claude\.credentials.json` presente). La scrittura atomica (`tmp` + `rename`) su Windows fallisce se il file di destinazione è aperto da un altro processo (EPERM/EBUSY): serve un ritentativo breve.
3. **Login da bb** (`bin/open-login.sh`, `src/node-io.ts` `loginHelperPath`, `src/login.ts`).
   - Nuovo helper `bin/open-login.cmd` (stesso contratto dello `.sh`: un argomento, solo `https://`, `CLAUDE_SWITCHER_PRIVATE=1` → Chrome `--incognito`, altrimenti o senza Chrome il browser predefinito). Chrome si cerca in `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LocalAppData%`. Nessuna interpretazione dell'URL da parte della shell (attenzione a `&`, `%`, `^` nell'URL OAuth).
   - `loginHelperPath` sceglie `.cmd` su Windows e riconosce `\dist\`.
   - `spawn` di `claude` senza shell: su Windows `claude` installato via npm è `claude.cmd`, che `spawn` senza shell non trova. Il default di `claudeCommand` resta `"claude"`; su Windows il plugin lo risolve (PATH + `PATHEXT`, poi il `claude.exe` dentro il pacchetto npm `@anthropic-ai/claude-code`, poi `BB_CLAUDE_CODE_EXECUTABLE` se impostata). Un percorso completo impostato a mano vince sempre.
   - **Verificato il 2026-11-10** sul PC (Claude Code 2.1.322, `claude.exe` del pacchetto npm): `claude auth login` con `BROWSER=<...>\probe.cmd` esegue il `.cmd` (il probe ha scritto il suo file). Con `CLAUDE_CONFIG_DIR` impostato, `.claude.json` nasce **dentro** quella cartella, come su macOS/Linux. L'URL manuale resta il ripiego già esistente.
4. **Collegamenti** (`src/sessions.ts`, `src/login.ts` `prepare`, `src/node-io.ts` `link`/`symlink`).
   - File (`.jsonl` delle sessioni): hard link come oggi (NTFS li supporta senza privilegi; fra volumi diversi EXDEV → oggi si ripiega su symlink di file, che su Windows richiede privilegi: vedi «Lasciato al builder»).
   - Cartelle (`projects/<key>`, `<sid>/`, voci `SHARED` che sono cartelle): **junction** (`fs.symlink(target, path, "junction")`), che non richiedono privilegi; target assoluto (le junction non accettano percorsi relativi).
   - `projectKey`: la regola «tutto ciò che non è lettera o cifra ASCII → `-`» produce già le chiavi che Claude Code usa su Windows (es. `E:\VSCODE\BB` → `E--VSCODE-BB`, visto in `~/.claude/projects`).
5. **`realpath` / confronti di cartelle** — su Windows `fs.realpath` risolve junction e restituisce la lettera di unità con la sua maiuscola; i confronti vanno fatti con `plainPath`.

## Collaudo atteso

- Suite esistente (`npm test`) verde su Linux **e** su Windows; i test che fissano percorsi POSIX restano tali e si aggiungono i casi Windows (percorsi, helper, scelta junction/hard link, risoluzione di `claude`).
- Prova dal vivo sul PC Windows, bb 0.49: (a) con il solo account di default il plugin legge l'uso senza avvisi; (b) login di un secondo account da bb fino a «logged in»; (c) un progetto spostato sul secondo account riprende un thread esistente (`--resume`) senza «No conversation found»; (d) `bb claude-switcher list` e `health` coerenti.

## Decisioni prese (da chi)

- Fork in `federicobasili24/bb-plugin-claude-switcher`, installato su Windows da lì (decisione dell'utente).
- Comportamento = quello del Mac, nessuna regola nuova (decisione dell'utente).
- Junction per le cartelle, hard link per i file (mia scelta: niente privilegi richiesti).
- Helper `.cmd` invece di PowerShell (mia scelta: avvio più rapido, nessuna policy di esecuzione da toccare).

- Voci `SHARED` che sono **file** (`settings.json`, `CLAUDE.md`) in una cartella account nuova su Windows (mia scelta): prima symlink di file (riesce se Windows ha la Modalità sviluppatore o il processo ha il privilegio); se fallisce con EPERM, hard link (stesso volume) e un avviso in `onShared` che spiega che un riscrittura atomica del file da parte di Claude Code può scollegarlo; mai copia. Le voci che sono cartelle (`projects`, `hooks`, `plugins`…) sempre junction.
- Versioni e aggiornamenti del fork (mia scelta): nessun tag nel fork; branch `windows` sopra il `main` a monte, riallineato con **rebase** quando serve; su Windows si installa da percorso locale del clone (`bb plugin install <clone>`), come gli altri plugin del team. Il codice di piattaforma sta in un modulo nuovo (`src/platform.ts`) e i file a monte cambiano il meno possibile, per tenere i rebase facili.
- Collaudo dal vivo nel bb di questo PC, dove il plugin è oggi installato da git e disabilitato: si rimuove quell'installazione e si installa dal clone del fork.

## Lasciato al builder

- Forma esatta del valore di `CLAUDE_CONFIG_DIR` su Windows: `C:\Users\x\.claude-accounts\team1` (nativo) — consigliato, purché lo stesso valore sia usato ovunque come chiave (nota account, confronto, `health`).
- Ritentativi del `rename` atomico (numero e attesa).
- Fallback fra volumi diversi per un file di sessione su Windows: junction alla cartella che lo contiene se possibile, altrimenti errore raccolto in `errors` (mai copia silenziosa, che divergerebbe).
- Organizzazione del codice di piattaforma (un modulo `src/platform.ts` con `isAbsolute`, `plainPath`, `join` è un'opzione).
