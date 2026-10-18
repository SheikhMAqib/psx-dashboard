"""PSX market agent: Claude plus CapitalStake data tools.

Usage:
  python agent.py                      interactive chat
  python agent.py "Top 5 cement stocks by market cap"
"""
import json
import os
import sys

import anthropic

from psx_tools import IMPLEMENTATIONS, TOOLS, ApiError

MODEL = os.environ.get("PSX_AGENT_MODEL", "claude-sonnet-5-5")
MAX_TOOL_ROUNDS = 12
MAX_RESULT_CHARS = 30_000

SYSTEM = """You are a Pakistan Stock Exchange (PSX) market analyst assistant.
Use the tools to get data; never quote prices, index levels or market caps from memory.
Prices are in PKR. Say when the market is closed, since figures then reflect the last session.
Keep answers short and concrete, and show symbols next to company names.
You provide information, not investment advice. Add a one-line reminder only when the user
asks what to buy or sell."""


def run_tool(name: str, args: dict) -> tuple[str, bool]:
    fn = IMPLEMENTATIONS.get(name)
    if fn is None:
        return f"Unknown tool: {name}", True
    try:
        text = json.dumps(fn(**args), ensure_ascii=False)
    except ApiError as e:
        return f"API error: {e}", True
    except Exception as e:  # network errors, bad arguments
        return f"Tool failed: {type(e).__name__}: {e}", True
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + '... [truncated; narrow the request with filters]'
    return text, False


def ask(client: anthropic.Anthropic, messages: list) -> str:
    """Run the tool loop until Claude answers. Mutates `messages` so chat keeps context."""
    for _ in range(MAX_TOOL_ROUNDS):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM,
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            return "".join(b.text for b in resp.content if b.type == "text")
        results = []
        for block in resp.content:
            if block.type == "tool_use":
                content, is_error = run_tool(block.name, block.input)
                print(f"  [tool] {block.name}({json.dumps(block.input)})", file=sys.stderr)
                results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": content, "is_error": is_error}
                )
        messages.append({"role": "user", "content": results})
    return "I hit the tool-call limit before finishing. Try a narrower question."


def main() -> None:
    for var in ("ANTHROPIC_API_KEY", "CAPITALSTAKE_TOKEN"):
        if not os.environ.get(var):
            sys.exit(f"Set {var} first (see README.md).")
    client = anthropic.Anthropic()
    messages: list = []

    if len(sys.argv) > 1:
        messages.append({"role": "user", "content": " ".join(sys.argv[1:])})
        print(ask(client, messages))
        return

    print("PSX agent ready. Ask about sectors, companies or indices. Ctrl-D to quit.")
    while True:
        try:
            q = input("\nyou> ").strip()
        except EOFError:
            print()
            return
        if not q:
            continue
        messages.append({"role": "user", "content": q})
        print("\n" + ask(client, messages))


if __name__ == "__main__":
    main()
