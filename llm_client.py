"""
llm_client.py — Unified LLM client.
Priority: Kimi → Groq → Gemini (whichever key works).
All use OpenAI-compatible format except Gemini which uses google-generativeai.
"""
import os, logging
from dotenv import load_dotenv

load_dotenv(override=True)
log = logging.getLogger(__name__)

KIMI_MODELS  = ["moonshot-v1-8k", "moonshot-v1-32k"]
GROQ_MODELS  = ["llama-3.3-70b-versatile", "llama3-groq-70b-8192-tool-use-preview", "llama-3.1-8b-instant"]
GEMINI_MODELS= ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"]


def _is_auth_error(err: str) -> bool:
    return any(x in err for x in [
        "401", "Invalid Authentication", "invalid_api_key",
        "Unauthorized", "authentication_error", "API key not valid",
        "invalid authentication", "INVALID_ARGUMENT",
    ])


def _openai_call(api_key, base_url, models, messages, tools, temperature, max_tokens, provider):
    """Try a list of models on an OpenAI-compatible endpoint."""
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)
    last_err = None
    for model in models:
        try:
            kwargs = dict(model=model, messages=messages,
                          temperature=temperature, max_tokens=max_tokens)
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            resp = client.chat.completions.create(**kwargs)
            choice = resp.choices[0]
            log.info("LLM OK provider=%s model=%s", provider, model)
            return {"provider": provider, "model": model,
                    "message": choice.message, "finish_reason": choice.finish_reason}
        except Exception as e:
            err = str(e)
            log.warning("FAIL %s/%s: %s", provider, model, err[:120])
            last_err = err
            if _is_auth_error(err):
                raise Exception(f"AUTH_FAIL:{provider}:{err}")
            continue
    raise Exception(f"All {provider} models failed. Last: {last_err}")


def _gemini_call(api_key, models, messages, temperature, max_tokens):
    """Call Gemini via google-generativeai SDK. Tool calling simplified."""
    try:
        import google.generativeai as genai
    except ImportError:
        raise ImportError("Run: pip install google-generativeai")

    genai.configure(api_key=api_key)
    # Convert OpenAI-format messages → Gemini format
    sys_parts = [m["content"] for m in messages if m["role"] == "system"]
    chat_msgs = [m for m in messages if m["role"] != "system"]

    system_text = "\n\n".join(sys_parts) if sys_parts else ""

    last_err = None
    for model_name in models:
        try:
            gen_config = genai.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            )
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_text or None,
                generation_config=gen_config,
            )
            # Build history + last user message
            history = []
            for m in chat_msgs[:-1]:
                role = "user" if m["role"] == "user" else "model"
                content = m.get("content") or ""
                if isinstance(content, list):
                    content = " ".join(p.get("text","") for p in content if isinstance(p,dict))
                if content:
                    history.append({"role": role, "parts": [content]})

            last_msg = chat_msgs[-1] if chat_msgs else {"role":"user","content":"Hello"}
            last_content = last_msg.get("content","")
            if isinstance(last_content, list):
                last_content = " ".join(p.get("text","") for p in last_content if isinstance(p,dict))

            chat = model.start_chat(history=history)
            response = chat.send_message(last_content)
            text = response.text

            # Wrap in a compatible message-like object
            class _Msg:
                def __init__(self, content):
                    self.content = content
                    self.tool_calls = []
            log.info("LLM OK provider=gemini model=%s", model_name)
            return {"provider": "gemini", "model": model_name,
                    "message": _Msg(text), "finish_reason": "stop"}
        except Exception as e:
            err = str(e)
            log.warning("FAIL gemini/%s: %s", model_name, err[:120])
            last_err = err
            if _is_auth_error(err):
                raise Exception(f"AUTH_FAIL:gemini:{err}")
            continue
    raise Exception(f"All Gemini models failed. Last: {last_err}")


def chat_completion(messages, tools=None, model_hint=None,
                    temperature=0.15, max_tokens=4096):
    """
    Try providers in order: Kimi → Groq → Gemini.
    Skips any provider whose key is missing or returns 401.
    Returns: {"provider", "model", "message", "finish_reason"}
    """
    load_dotenv(override=True)

    kimi_key   = os.getenv("KIMI_API_KEY",   "").strip()
    groq_key   = os.getenv("GROQ_API_KEY",   "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    errors = []

    # 1. Kimi
    if kimi_key:
        try:
            mdls = [model_hint] if model_hint and "moonshot" in (model_hint or "") else []
            mdls += [m for m in KIMI_MODELS if m not in mdls]
            return _openai_call(kimi_key, "https://api.moonshot.cn/v1",
                                mdls, messages, tools, temperature, max_tokens, "kimi")
        except Exception as e:
            msg = str(e)
            log.warning("Kimi failed: %s", msg[:120])
            errors.append(f"Kimi: {msg[:80]}")
            if "AUTH_FAIL" not in msg:
                pass  # non-auth error, still try next

    # 2. Groq
    if groq_key:
        try:
            mdls = [model_hint] if model_hint and "llama" in (model_hint or "") else []
            mdls += [m for m in GROQ_MODELS if m not in mdls]
            return _openai_call(groq_key, "https://api.groq.com/openai/v1",
                                mdls, messages, tools, temperature, max_tokens, "groq")
        except Exception as e:
            msg = str(e)
            log.warning("Groq failed: %s", msg[:120])
            errors.append(f"Groq: {msg[:80]}")

    # 3. Gemini (no tool-calling — falls back to text-only mode)
    if gemini_key:
        try:
            mdls = [model_hint] if model_hint and "gemini" in (model_hint or "") else []
            mdls += [m for m in GEMINI_MODELS if m not in mdls]
            return _gemini_call(gemini_key, mdls, messages, temperature, max_tokens)
        except Exception as e:
            msg = str(e)
            log.warning("Gemini failed: %s", msg[:120])
            errors.append(f"Gemini: {msg[:80]}")

    if not any([kimi_key, groq_key, gemini_key]):
        raise Exception(
            "❌ No API key found!\n\n"
            "Add at least one to your .env file:\n"
            "  GROQ_API_KEY=gsk_...   (free at console.groq.com)\n"
            "  GEMINI_API_KEY=AIza... (free at aistudio.google.com)\n"
            "  KIMI_API_KEY=sk-...    (from platform.moonshot.cn)"
        )

    errors_str = ' | '.join(errors)
    has_rate_limit = '429' in errors_str
    has_auth_error = '401' in errors_str or 'AUTH_FAIL' in errors_str

    if has_rate_limit and not has_auth_error:
        reason = "429 = rate limit reached (too many requests)"
        fix = (
            "Fix: Wait a few minutes then try again, or use a different provider.\n"
            "• Groq free tier: 30 req/min — fastest recovery\n"
            "• Gemini free tier: 1500 req/day limit\n"
            "• Switch providers or add multiple keys in .env"
        )
    elif has_auth_error:
        reason = "401 = key expired/invalid"
        fix = (
            "Fix: Get a fresh key from one of these FREE sources:\n"
            "• Groq (fastest, free): https://console.groq.com → API Keys\n"
            "• Gemini (free 1500/day): https://aistudio.google.com → Get API Key\n"
            "• Kimi: https://platform.moonshot.cn\n\n"
            "Then update your .env file and restart Flask."
        )
    else:
        reason = "all providers returned errors"
        fix = (
            "Fix: Check your API keys and network connection.\n"
            "• Groq: https://console.groq.com → API Keys\n"
            "• Gemini: https://aistudio.google.com → Get API Key"
        )

    raise Exception(
        f"All LLM providers failed ({reason}).\n\n"
        f"{fix}\n\n"
        f"Details: {errors_str}"
    )


def active_provider_info() -> dict:
    """Return which keys are configured."""
    load_dotenv(override=True)
    return {
        "kimi":   bool(os.getenv("KIMI_API_KEY","").strip()),
        "groq":   bool(os.getenv("GROQ_API_KEY","").strip()),
        "gemini": bool(os.getenv("GEMINI_API_KEY","").strip()),
    }
