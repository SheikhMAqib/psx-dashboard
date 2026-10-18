"""Tailwind web dashboard for PSX market data and the Claude assistant."""
import os
import re

import anthropic
import httpx
from flask import Flask, jsonify, render_template, request

from agent import ask
from psx_tools import (
    ApiError,
    find_stocks,
    get_quote,
    get_stock,
    list_indices,
    list_sectors,
    market_state,
    sector_overview,
)


app = Flask(__name__, static_folder=None if os.environ.get("VERCEL") else "static")
app.config["TEMPLATES_AUTO_RELOAD"] = True
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.&-]{1,20}$")


def _api_error(error: Exception):
    app.logger.warning("PSX API request failed: %s", error)
    return jsonify({"error": str(error)}), 502


@app.get("/")
def home():
    return render_template("dashboard.html")


@app.get("/api/config")
def config():
    return jsonify(
        {
            "market_available": bool(os.environ.get("CAPITALSTAKE_TOKEN")),
            "assistant_available": bool(os.environ.get("ANTHROPIC_API_KEY")),
        }
    )


@app.get("/api/market")
def market():
    sections = {
        "state": market_state,
        "indices": list_indices,
        "sectors": sector_overview,
        "sector_list": list_sectors,
    }
    result = {}
    for name, fetch in sections.items():
        try:
            result[name] = {"data": fetch(), "error": None}
        except (ApiError, httpx.HTTPError, ValueError) as error:
            app.logger.warning("Could not load %s: %s", name, error)
            result[name] = {"data": None, "error": str(error)}
    return jsonify(result)


@app.get("/api/stocks")
def stocks():
    try:
        page = max(1, int(request.args.get("page", "1")))
        limit = max(1, min(100, int(request.args.get("limit", "25"))))
    except ValueError:
        return jsonify({"error": "Page and limit must be integers."}), 400
    sector = request.args.get("sector") or None
    query = request.args.get("q", "").strip() or None
    try:
        return jsonify(
            find_stocks(
                sector=sector,
                query=query,
                limit=limit,
                offset=(page - 1) * limit,
            )
        )
    except (ApiError, httpx.HTTPError, ValueError) as error:
        return _api_error(error)


@app.get("/api/stock/<symbol>")
def stock_detail(symbol: str):
    symbol = symbol.upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        return jsonify({"error": "Invalid stock symbol."}), 400
    try:
        stock = get_stock(symbol)
        quote = get_quote(symbol)
        profile = None
        profile_error = None
        try:
            profile = company_profile(symbol)
        except (ApiError, httpx.HTTPError, ValueError) as error:
            profile_error = str(error)
        return jsonify(
            {
                "stock": stock,
                "quote": quote,
                "profile": profile,
                "profile_error": profile_error,
            }
        )
    except (ApiError, httpx.HTTPError, ValueError) as error:
        return _api_error(error)


@app.post("/api/chat")
def chat():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Expected a JSON request body."}), 400
    question = body.get("message")
    if not isinstance(question, str) or not question.strip():
        return jsonify({"error": "Enter a question to continue."}), 400
    if len(question) > 4000:
        return jsonify({"error": "Questions must be 4,000 characters or fewer."}), 400
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return jsonify({"error": "Set ANTHROPIC_API_KEY to enable assistant chat."}), 503

    history = body.get("history", [])
    if not isinstance(history, list):
        return jsonify({"error": "Chat history must be a list."}), 400
    messages = []
    for entry in history[-20:]:
        if (
            isinstance(entry, dict)
            and entry.get("role") in ("user", "assistant")
            and isinstance(entry.get("content"), str)
        ):
            messages.append(
                {"role": entry["role"], "content": entry["content"][:12000]}
            )
    messages.append({"role": "user", "content": question.strip()})
    try:
        answer = ask(anthropic.Anthropic(), messages)
        return jsonify({"answer": answer})
    except (anthropic.APIError, ApiError, httpx.HTTPError, ValueError) as error:
        app.logger.exception("Assistant request failed")
        return jsonify({"error": str(error)}), 502


if __name__ == "__main__":
    app.run(
        host=os.environ.get("PSX_DASHBOARD_HOST", "127.0.0.1"),
        port=int(os.environ.get("PSX_DASHBOARD_PORT", "5000")),
        debug=False,
    )
