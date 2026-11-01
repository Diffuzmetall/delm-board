# Sources and MIT notices

## Local adaptation

This distribution extracts committed source from [Diffuzmetall/pi-durable-delm](https://github.com/Diffuzmetall/pi-durable-delm), revision `daf23adc433181c21baaad8222f5b7c4d6827c07`. It does not use that checkout's uncommitted files. The original MIT license, Copyright (c) 2026 Diffuzmetall, is retained verbatim in `LICENSE`.

`board/scripts/delm_domain.py`, `delm_delivery.py`, `delm_leases.py`, vendor board code and core tests preserve the existing domain implementation. `delm_local.py` drops generated host bindings and adds explicit Pi onboarding. `delm_board.py` retains the read-only terminal view but drops host observers and all agent-session database access. `adapters/durable/wait.mjs` and `protocol.mjs` adapt the generic SDK wait/protocol; `board.mjs` holds shared board-only transport/projection helpers. The separate Pi entry uses the official ExtensionAPI. Tests' loopback deterministic provider is also extracted from the same committed source.

## DeLM Python runtime

Original source: [yuzhenmao/DeLM](https://github.com/yuzhenmao/DeLM/tree/66617616e708758f91624e5cc03659732b82f6a6), MIT. Its complete original notice remains verbatim in `board/vendor/DeLM/LICENSE`.

Included source: `board/__init__.py`, `board/shared_context.py`, `board/protected_board.py`, `board/context_client.py`, `runtime/__init__.py`. `runtime/http.py` is the board HTTP handler extracted from `runtime/containers.py`; container launch, Docker/Codex execution and session collection are deliberately excluded. The original DeLM experiment runner is not distributed or invoked.

## Public Pi

Public Pi/Durable 1.4.0 dependencies come from npm and are pinned in the lockfile. Public source reference: [earendil-works/pi v1.4.0](https://github.com/earendil-works/pi/tree/v1.4.0). The original upstream MIT notice, Copyright (c) 2025 Mario Zechner, is retained verbatim in `LICENSES/pi-native.txt`. No upstream API patch, replacement host, credentials, author configuration or private/source-lane import hook is included.
