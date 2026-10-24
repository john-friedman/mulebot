import argparse
import json
import sys

from .agent import Agent
from .providers import DEFAULT_MODELS


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Chat with Datamule's APIs.")
    parser.add_argument("--provider", required=True, choices=DEFAULT_MODELS, help="Model provider.")
    parser.add_argument("--model", help="Model ID; defaults to MULEBOT_MODEL or the provider's default.")
    parser.add_argument("--tables", help="Optional comma-separated table allowlist.")
    commands = parser.add_subparsers(dest="command", required=True)
    chat = commands.add_parser("chat", help="Print raw events as newline-delimited JSON.")
    chat.add_argument("message", nargs="?", help="Omit for interactive chat or piped input.")
    serve = commands.add_parser("serve", help="Run the local browser interface.")
    serve.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    settings = {"provider": args.provider, "model": args.model, "allowed_tables": None}
    if args.tables is not None:
        settings["allowed_tables"] = [name.strip() for name in args.tables.split(",") if name.strip()]
    try:
        if args.command == "serve":
            from .server import serve
            serve(port=args.port, **settings)
            return 0
        bot = Agent(**settings)
        failed = False
        while True:
            if args.message is not None:
                message = args.message
            else:
                if sys.stdin.isatty():
                    print("> ", end="", file=sys.stderr, flush=True)
                message = sys.stdin.readline()
                if not message:
                    break
                message = message.strip()
                if not message:
                    continue
            for event in bot.run(message):
                print(json.dumps(event, ensure_ascii=False), flush=True)
                failed = failed or event["type"] == "error"
            if args.message is not None:
                break
        return int(failed)
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}), flush=True)
        return 1
