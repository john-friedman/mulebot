"""Translate the shared agent history to each provider's HTTP API."""

import json
import os
from urllib.parse import quote
from uuid import uuid4


DEFAULT_MODELS = {
    "openrouter": "deepseek/deepseek-v4.1-flash-1017:nitro",
    "openai": "gpt-5.4-mini",
    "gemini": "gemini-3.8-flash",
    "anthropic": "claude-sonnet-5-5",
}
KEY_VARIABLES = {
    "openrouter": "OPENROUTER_API_KEY", "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
}


def validate_provider(provider):
    if not isinstance(provider, str) or provider not in DEFAULT_MODELS:
        raise ValueError("Choose a provider: " + ", ".join(DEFAULT_MODELS) + ".")
    return provider


def resolve_model(provider, model=None):
    validate_provider(provider)
    model = model if model is not None else os.environ.get("MULEBOT_MODEL") or DEFAULT_MODELS[provider]
    if not isinstance(model, str) or not model.strip() or len(model) > 200 or any(c.isspace() for c in model.strip()):
        raise ValueError("Enter a model ID of at most 200 characters.")
    return model.strip()


def credentials(provider, api_key=None, model_api_key=None):
    validate_provider(provider)
    api_key = api_key or os.environ.get("DATAMULE_API_KEY")
    model_api_key = model_api_key or os.environ.get(KEY_VARIABLES[provider])
    missing = [name for name, value in (("DATAMULE_API_KEY", api_key), (KEY_VARIABLES[provider], model_api_key))
               if not isinstance(value, str) or not value.strip()]
    if missing:
        raise ValueError("Pass the corresponding keys or set " + " and ".join(missing) + ".")
    return api_key, model_api_key


def _native_content(message, provider):
    data = message.get("provider_data") or {}
    return data.get("content") if data.get("provider") == provider else None


def build_request(provider, model, key, messages, tools, tool_choice, reasoning_effort):
    headers = {"Content-Type": "application/json"}
    if provider in ("openrouter", "openai"):
        history = []
        for message in messages:
            entry = {k: v for k, v in message.items() if k in ("role", "content", "tool_calls", "tool_call_id")}
            if provider == "openrouter":
                entry.update({k: v for k, v in message.items() if k in ("reasoning", "reasoning_details")})
            history.append(entry)
        payload = {"model": model, "messages": history}
        if tools:
            payload.update(tools=tools, tool_choice=tool_choice, parallel_tool_calls=False)
        if provider == "openrouter":
            payload.update(max_tokens=8192, reasoning={"effort": reasoning_effort or "medium", "exclude": False})
            url = "https://openrouter.ai/api/v1/chat/completions"
        else:
            payload["max_completion_tokens"] = 8192
            if reasoning_effort:
                payload["reasoning_effort"] = reasoning_effort
            url = "https://api.openai.com/v1/chat/completions"
        headers["Authorization"] = f"Bearer {key}"
        return url, headers, payload

    system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
    history, calls = [], {}
    for message in messages:
        role = message["role"]
        if role == "system":
            continue
        for call in message.get("tool_calls", []):
            calls[call["id"]] = call
        native = _native_content(message, provider) if role == "assistant" else None
        if provider == "anthropic":
            target_role = "assistant" if role == "assistant" else "user"
            if role == "tool":
                content = [{"type": "tool_result", "tool_use_id": message["tool_call_id"], "content": message["content"]}]
            elif native is not None:
                content = native
            else:
                content = [{"type": "text", "text": message["content"]}] if message["content"] else []
                content += [{"type": "tool_use", "id": call["id"], "name": call["function"]["name"],
                             "input": json.loads(call["function"]["arguments"])} for call in message.get("tool_calls", [])]
        else:
            target_role = "model" if role == "assistant" else "user"
            if role == "tool":
                call = calls[message["tool_call_id"]]
                response = json.loads(message["content"])
                result = {"name": call["function"]["name"], "response": response if isinstance(response, dict) else {"result": response}}
                # Older Gemini versions don't assign function-call IDs.
                if not call["id"].startswith("mulebot_"):
                    result["id"] = call["id"]
                content = [{"functionResponse": result}]
            elif native is not None:
                content = native
            else:
                content = [{"text": message["content"]}] if message["content"] else []
                content += [{"functionCall": {"name": call["function"]["name"], "args": json.loads(call["function"]["arguments"])}}
                            for call in message.get("tool_calls", [])]
        field = "content" if provider == "anthropic" else "parts"
        if content:
            # Group parallel results into one user message, as required by Claude.
            if history and history[-1]["role"] == target_role:
                history[-1][field].extend(content)
            else:
                history.append({"role": target_role, field: list(content)})

    if provider == "anthropic":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
        payload = {"model": model, "system": system, "messages": history, "max_tokens": 8192}
        if tools:
            payload["tools"] = [{"name": tool["function"]["name"], "description": tool["function"]["description"],
                                 "input_schema": tool["function"]["parameters"]} for tool in tools]
            payload["tool_choice"] = {"type": tool_choice}
            if tool_choice == "auto":
                payload["tool_choice"]["disable_parallel_tool_use"] = True
        return "https://api.anthropic.com/v1/messages", headers, payload

    headers["x-goog-api-key"] = key
    payload = {"systemInstruction": {"parts": [{"text": system}]}, "contents": history,
               "generationConfig": {"maxOutputTokens": 8192}}
    if tools:
        payload["tools"] = [{"functionDeclarations": [{"name": tool["function"]["name"],
                              "description": tool["function"]["description"],
                              "parametersJsonSchema": tool["function"]["parameters"]} for tool in tools]}]
        payload["toolConfig"] = {"functionCallingConfig": {"mode": tool_choice.upper()}}
    return f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent", headers, payload


def normalize_response(provider, response):
    if provider in ("openrouter", "openai") or response.get("error"):
        return response
    calls, text, reasoning = [], [], []
    if provider == "anthropic":
        content = response.get("content") or []
        for block in content:
            if block["type"] == "text":
                text.append(block["text"])
            elif block["type"] == "thinking":
                reasoning.append(block["thinking"])
            elif block["type"] == "tool_use":
                calls.append({"id": block["id"], "type": "function", "function": {
                    "name": block["name"], "arguments": json.dumps(block["input"])}})
        usage = dict(response.get("usage") or {})
        usage.update(prompt_tokens=usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_read_input_tokens", 0),
                     completion_tokens=usage.get("output_tokens", 0))
        model, response_id = response.get("model"), response.get("id")
    else:
        candidate = (response.get("candidates") or [{}])[0]
        content = (candidate.get("content") or {}).get("parts") or []
        for part in content:
            if "text" in part:
                (reasoning if part.get("thought") else text).append(part["text"])
            if "functionCall" in part:
                call = part["functionCall"]
                calls.append({"id": call.get("id") or "mulebot_" + uuid4().hex, "type": "function", "function": {
                    "name": call["name"], "arguments": json.dumps(call.get("args") or {})}})
        usage = dict(response.get("usageMetadata") or {})
        usage.update(prompt_tokens=usage.get("promptTokenCount", 0),
                     completion_tokens=usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0))
        model, response_id = response.get("modelVersion"), response.get("responseId")
    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    message = {"content": "\n\n".join(text), "tool_calls": calls, "reasoning": "\n\n".join(reasoning),
               "provider_data": {"provider": provider, "content": content}}
    return {"id": response_id, "model": model, "usage": usage, "choices": [{"message": message}]}
