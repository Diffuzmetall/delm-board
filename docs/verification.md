# Local verification

Candidate: local uncommitted `delm-board` 0.1.0, extracted from committed `pi-durable-delm` `daf23adc433181c21baaad8222f5b7c4d6827c07`. No publication or independent final acceptance is claimed here; the parent owns those steps.

Public direct dependencies installed from this checkout's own package/lockfile: `@earendil-works/pi-durable`, `pi-coding-agent`, `pi-ai`, `chord`, all **1.4.0**. Runtime used: Node **v24.19.0**, Python **3.13**. Installed stock executable resolves to `@earendil-works/pi-coding-agent/dist/bundle/cli.js`, not a source CLI or custom host.

## Recorded checks

- `npm install --ignore-scripts --no-audit --no-fund`: passed; 124 packages installed. `npm ls --depth=0` confirms four direct public 1.4.0 versions.
- `HOME=$(mktemp -d) node --test tests/sdk.test.mjs tests/pi.test.mjs`: **15/15 passed** (9 SDK, 6 Pi lifecycle). After adding an explicit retained-transcript assertion, `HOME=$(mktemp -d) node --test --test-name-pattern='live registry model-driven' tests/sdk.test.mjs`: **1/1 passed** on that final test. Product adapter files were unchanged between those checks.
- `HOME=$(mktemp -d) npm run test:core`: **34/34 passed** (32 inherited/adapted core tests, 2 no-Node/view boundary tests). Python 3.13 emitted nonfatal unclosed-SQLite ResourceWarnings in the inherited suite; no test failures. No unrelated legacy connection refactor is claimed.
- `python3 tests/rpc.py`: **passed** actual bundled stock CLI, real ExtensionAPI loader, deterministic loopback OpenAI-compatible model, real Python board. Observed wait tool cycle 0.026 seconds; 17 deterministic model requests. Checks: repeated connect without launching Pi, board projection tool, nonblocking arm, board event, actual same-session follow-up, snapshot read/ACK, another wait, real RPC fork refusal, session switch/restore, cancellation and orderly shutdown.
- `python3 tests/package.py`: **passed**. The 26-file npm archive contains the Python board, both separate entries, domain docs and original MIT notices; no private home paths, credentials/run state, sessions, databases, node_modules, bytecode or private host imports. Extracted into a fresh temporary directory, installed its own public dependencies, loaded the SDK definition into an actual public registry, and repeated the complete stock bundled CLI/RPC flow there (17 deterministic model requests; timing recorded in `docs/evidence/package.json`). Initial archive inspection caught Python bytecode inclusion; a board-local npm exclusion fixed it before this pass.

## Parent final-candidate checks

The parent found an onboarding defect after the implementation handoff: loading the package without a selected DeLM run failed the official extension loader. A new `tests/pi-unconfigured.test.mjs` reproduced that failure before the fix. The unconfigured entry is now inert, while partial/invalid bindings still fail. Node requirements were aligned to the public baseline, >=22.19.0.

- `HOME=$(mktemp -d) env -u DELM_RUN -u DELM_ACTOR -u DELM_SESSION_FILE npm run test:pi`: **7/7 passed**, including the real public loader with no run selected and the existing genuine AgentSession lifecycle checks.
- `python3 tests/package.py`: **passed again on the corrected candidate**. In a fresh installed package, the actual npm CLI loaded the unconfigured package successfully without a model call, then the configured real RPC flow passed with 17 deterministic loopback requests. SDK smoke, archive hygiene and the separate board distribution also passed. See `docs/evidence/parent-final.json`.

- Parent PTY check: the actual curses view displayed a synthetic task, `q` closed only the view, the board backend stayed alive, and both board SQLite file hashes were unchanged.

Board and SDK implementation files were unchanged by this parent correction. Their recorded implementation checks remain applicable. Independent final review is recorded separately before delivery; no exactly-once Pi admission or production deployment is inferred.

## Evidence and scope

Sanitized command summaries are kept in `docs/evidence/`; raw private test homes, session JSONL, request payloads and board databases are not included. Fixtures use temporary isolated homes/workspaces/sessions, model-only faux providers or a deterministic loopback HTTP model. They do not load author-private host tests, source-lane hooks, live credentials, billed models or mocked admission/extension loaders.

SDK tests use the actual public Harness, Node SQLite storage and scheduler: live-registry installation after Harness opening, model-driven board publication/read/ACK, root wake, exact dependency relevance, restart/dedup, caller admission denial, board lock contention, effective conversation environment guards and active wait cancel/drain before uninstall. Detach checks preserve an unrelated live task, all pre-existing caller transcript entry IDs and an unread receipt; accepted submission is reported separately.

Stock RPC covers real load/tool/wake/readACK/fork/switch flow. Tree navigation, reload and uncertain-send lifecycle seams use the **genuine public AgentSession API**, with only its model replaced. These are not claimed as RPC tree/reload coverage. Rewinding an armed branch after an intent was recorded elsewhere in the same session cannot erase that send fence or auto-resend. The asynchronous send rejection test drives real compaction preflight rejection; persisted interruption tests also cover an intent marker with no visible wake and explicit manual recovery. Pi appendEntry/sendUserMessage are void and non-atomic: attempted status is never called durable admission, and no exactly-once crash guarantee is claimed.

Board-only tests include Python with an empty PATH (Node unavailable), HTTP tools/fences/snapshot/ACK, and the inherited read-only terminal view. Board execution/wait status is intentionally not displayed because it belongs to the adapter/host. Advisory leases remain non-enforcing.
