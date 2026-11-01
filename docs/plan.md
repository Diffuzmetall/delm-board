# Portable DeLM board and public Pi/Durable 1.4 adapter

> Historical plan for the first private delivery. The separately authorized public documentation/release scope is recorded in [publication.md](publication.md). This plan does not grant an installer permission to publish anything.

## Outcome and authority

Build for friends who use their own public installation, not the author's host. Deliver the existing DeLM task board as a standalone Python component and a detachable integration package. Target the current public npm release, 1.4.0, verified with `npm view` for both pi-durable and pi-coding-agent. Publish only to a new PRIVATE `Diffuzmetall/delm-board` repository. Do not change either existing public DeLM repository, author runtime, global configuration, credentials, or existing sessions. No live-model calls, npm publication, deployment, or upstream patch.

The user requested Observe, Thinking, Poteto simplification, Planning, plan review, implementation, testing, and private GitHub delivery. Planning owns this plan. Poteto principles and architect references are adapted to this bounded extraction, not claimed as a full arena/playbook run.

## Observe

Committed source baseline: `Diffuzmetall/pi-durable-delm@daf23ad`. Exclude its uncommitted and untracked work. Read source through this Git revision when extracting it.

The current Python board already owns domain events, fences, receipts and advisory leases. `scripts/delm_local.py` nevertheless emits a native14 module, and `scripts/delm_board.py` imports host-specific observability. Those reverse dependencies must leave the board distribution.

The public source version is upstream `earendil-works/pi` v1.4.0, `4a080252f06caf63a525d7873c5d94d3c23887e0`. npm latest is 1.4.0. Public pi-durable is a library with no CLI binary. Public pi-coding-agent is an ordinary Pi CLI and does not construct a Durable Harness. A private-host adapter or an SDK-only example cannot be presented as a plug-in for the stock CLI.

Existing generic `createDelmWait` supports the public Durable registry without private admission. Its default installer clones the registry; use a factory installed into the caller's actual live registry instead. Preserve real input policy when a caller supplies one.

Independent read-only grounding inspected the complete public Durable README, Pi extensions/packages docs, current generic adapter and public runtime sources. It confirmed the dual entry points below. Source references and the resulting limitations belong in the delivered docs.

## Thinking and simplification

The board owns task state. The adapter owns session bindings and wake behavior. Neither owns the other component's private state.

The claim that a new general plugin framework is required is rejected. The existing actor-bound CLI is a sufficient first transport. Reuse its validation, stable request IDs and explicit receipt acknowledgement. No new server, message bus, adapter registry, generic provider framework, or Claude/Codex support.

Two concrete entry points serve different actual public APIs:

- `adapters/durable/index.mjs`: a public Durable SDK factory. The consumer installs its definition into the registry already used by its Harness. Never create a second Harness/storage owner or access Native session SQL.
- `adapters/durable/pi.mjs`: an official Pi ExtensionAPI factory. This is the installable path for stock public CLI users. It registers board tools, nonblocking waits, and local session-aware watchers. It must not import the Durable entry eagerly or claim Durable crash-exact scheduling.

Laziness Protocol selects reuse of the existing board/domain protocol and generic Durable wait machinery instead of reimplementation. Model the Domain selects a single persisted wait record bound to run, actor, workspace and the current session. Stable wake identifiers identify evidence; a wake does not acknowledge a receipt.

Alternative 1, SDK-only: smaller code but friends cannot load it into the stock CLI. Rejected as the only delivery. Alternative 2, standalone replacement host: creates a new runtime/configuration burden. Rejected. Alternative 3, new universal plugin framework: no current second external backend needs it. Rejected.

## Caller experience

The delivered checkout has `board/`, `adapters/durable/`, `bin/delm`, tests and notices. The Python board starts without npm, Node, Durable or author configuration.

Proposed commands, to be implemented and verified:

```sh
./bin/delm init /private/run --shared-workspace /project --n 2 --task 'Approved task'
./bin/delm serve /private/run
./bin/delm connect pi /private/run
```

`connect pi` prepares or prints exact per-actor public Pi commands with separate recorded session paths and explicit extension bindings. Commands set the approved workspace and actor-bound context PATH and identify the board-server prerequisite. Never label these commands a connection to a Durable Harness. It does not execute a model, start another host, change global Pi settings, or silently replace an existing session. Repeating preparation must preserve bindings and user files. Connecting to an arbitrary already-running TUI is not promised; users open/reopen the printed session commands or load the package through the supported lifecycle.

The SDK entry has a separate short recipe using `registry.install(createDurableAdapter({run, actor}))`. It uses the caller's existing models, storage, registry and execution environment. Explicit tool/extension selection remains the caller's responsibility.

## Acceptance

1. Board extraction starts and projects real tasks using Python stdlib alone. Its distributed runtime has no imports, generated bindings, SQL access or hardcoded paths to a Durable/private host. Existing domain behavior and read/ACK semantics remain covered.
2. Public Durable 1.4.0 accepts the factory in an existing live registry. Test actual SDK storage/scheduler with only the model replaced. Prove same-conversation wake, relevant task completion, explicit read/ACK, retained caller guard, effective conversation workspace validation, cancellation and restart deduplication. Installing the adapter must not create a Harness or choose credentials/models.
3. Stock public Pi 1.4.0 actually loads the Pi entry in an isolated profile through the installed npm `.bin/pi` (`dist/bundle/cli.js`), not a source CLI substitute. Test real tool calls against a real Python board, immediate nonblocking wait, a board-event follow-up, exact session/workspace binding and watcher cleanup. Reconcile the active branch on `session_tree` as well as startup, invalidate obsolete asynchronous callbacks, and test navigating away from and back to a pending wait. A forked session must not silently inherit the source session's actor binding. Test reload/session-switch isolation. Do not call a synchronous void send result a successful durable admission.
4. Pi's pending wait is persisted through its official custom-entry API. Reconstruct it from the active branch. Persist an attempted-wake marker before calling the void send API. After an ambiguous attempt, do not automatically resend. Expose explicit manual rearm/recovery, reconcile visible wake identifiers, and retain unread board receipts for read/ACK. Test interruption before/after the attempt marker and an asynchronous send rejection. Document that this API has no atomic request-ID admission receipt and cannot provide exactly-once wake across a crash. Do not implement retry machinery that can flood a session.

Safe detach is cancel/drain-before-uninstall for adapter-owned Durable wait tasks. Uninstall alone, ordinary conversation abort or removal of files is not cancellation. Already-admitted model input is a separate boundary and must not be erased or reported as unsubmitted. Test detaching an active wait while preserving unrelated tasks, Native session data and unread board receipts. Pi teardown invalidates callback generations before closing watchers. The small SDK surface must expose or document the explicit cancellation/drain operation using only the public Harness APIs.
5. Build the distributable package. In a fresh temporary directory install/extract it and exercise the documented board and adapter paths with public registry dependencies. Verify no private home paths, credentials, run tokens, SQLite databases, node_modules or author-host imports in the archive. Preserve all upstream MIT notices.
6. Independent final review/QA covers the integrated candidate. Record actual passes/failures/unavailable checks and public versions. Push only a private repository and verify its remote SHA and visibility. Public repositories and their WIP remain unchanged.

## Working increments

1. Standalone board and CLI. Reuse committed Python domain/vendor code and adapt imports/layout. Remove core Native-module generation and host wait observations. Preserve actor-bound context CLI and a board-only terminal view. Run the inherited relevant Python suites plus a no-Node boundary check.
2. Public Durable SDK factory. Reuse the generic wait implementation/protocol; expose a single factory installed into the live registry. Keep effective workspace checks at the tool/wake boundary. Run real public SDK model-only integration and regressions before proceeding.
3. Stock Pi adapter and onboarding. Register tools via ExtensionAPI, persist/recover wait records through custom entries, use follow-up input for wakes, and close obsolete watchers on shutdown, reload, session/branch changes. Add `connect pi` that provides actor/session-specific commands without global changes. Keep the Durable connection as the clearly separate existing-registry recipe. Run real stock npm CLI/RPC acceptance against a deterministic loopback model provider.
4. Package and private delivery. Freeze one candidate; check archive, notices, docs and core independence. Obtain read-only independent acceptance, fix material findings, then commit/push to the new private repository.

## Throughput checkpoint

- Blocking first steps: public API grounding and this plan review precede code. Real stock install/loader verification precedes release claims.
- Independent workstreams: source exploration and plan review are read-only. One implementation owner covers the coupled board/adapter/package boundary; final reviewer is a separate context.
- Shared mutable state: only the new repository is writable. No parallel writers. Disposable test runs have separate HOME, workspace, board and session paths.
- Smallest safe decomposition: one implementation worker avoids competing import/package contracts. The parent owns final acceptance and publication.

## Review and verification record

Independent read-only plan review by `delm-portable-plan-review` returned NEEDS_CHANGES on the first candidate. Its four findings are incorporated above: active-branch isolation, cancel/drain-before-uninstall, explicit ambiguous-send recovery policy, and honest `connect pi` naming plus real npm binary acceptance. These corrections do not change the selected architecture. Parent checked the corrections against the cited public APIs; no unresolved planning blocker remains. This is plan review, not implementation acceptance. Product checks above describe future evidence. Final verification goes in `docs/verification.md`.
