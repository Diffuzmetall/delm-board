"""Board HTTP transport extracted from DeLM runtime/containers.py (MIT)."""
import json
from http.server import BaseHTTPRequestHandler
from board.shared_context import BoardError

def handler(context, actors):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def do_GET(self):
            self.reply(200, {"ready": True} if self.path == "/health" else {"error": "not found"})

        def do_POST(self):
            actor = actors.get(self.path.removeprefix("/"))
            if actor is None:
                self.reply(403, {"error": "unknown identity"})
                return
            try:
                p = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                action = p["action"]
                if action == "read":
                    answer = context.read(actor, full=p.get("all", False), wait_seconds=p.get("wait") or 0,
                                          target=p.get("for") or None)
                elif action == "status":
                    answer = context.status(actor, p["text"])
                elif action == "claim":
                    answer = context.claim(actor, p["item"])
                elif action == "reserve":
                    answer = context.reserve(actor, p["subject"], p["detail"])
                elif action == "done":
                    answer = context.done(actor, p["item"], p["summary"], p.get("files"),
                                          request_id=p.get("request_id"))
                elif action == "note":
                    answer = context.note(actor, p["type"], p["text"], p["scope"], p["basis"], p.get("files"),
                                          request_id=p.get("request_id"))
                elif action == "attached":
                    answer = context.attached(actor, p["id"])
                elif action == "expand":
                    answer = context.expand(actor, p["id"], p.get("paths"))
                    answer["view"] = context.view_after(actor, "expand")
                elif action == "apply":
                    answer = context.apply(actor, p["id"], p["local"], p.get("paths"))
                    if not answer["applied"]:
                        answer["view"] = context.view_after(actor, "apply")
                elif action == "apply-error":
                    context.apply_error(actor, p["id"], p["error"]); answer = {"saved": True}
                elif action == "apply-result":
                    answer = context.apply_result(actor, p["id"], p["written"], p["success"])
                elif action == "publish":
                    answer = context.publish(actor, p["items"])
                else:
                    raise BoardError("unknown action")
                self.reply(200, answer)
            except (BoardError, KeyError, ValueError) as error:
                self.reply(400, {"error": str(error)})

        def reply(self, code, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    return Handler


