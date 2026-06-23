import os
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from deep_translator import GoogleTranslator

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

LANG_CODES = {
    "Filipino": "tl", "Spanish": "es", "French": "fr", "German": "de",
    "Japanese": "ja", "Chinese": "zh-CN", "Arabic": "ar", "Hindi": "hi",
    "Portuguese": "pt",
}


class TranslateRequest(BaseModel):
    texts: list[str]
    target: str
    source: str = "en"


class InjectionRequest(BaseModel):
    text: str


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "ok"}


@app.post("/translate")
async def translate(req: TranslateRequest):
    target_code = "en" if req.target == "English" else LANG_CODES.get(req.target, req.target)
    if not target_code:
        return {"translations": req.texts}

    translations = []
    for text in req.texts:
        if not text or not text.strip():
            translations.append(text)
            continue
        try:
            result = GoogleTranslator(source=req.source, target=target_code).translate(text)
            translations.append(result or text)
        except Exception:
            translations.append(text)

    return {"translations": translations}


@app.post("/check-injection")
async def check_injection(req: InjectionRequest):
    token = os.getenv("HF_TOKEN")
    if not token or not req.text or not req.text.strip():
        return {"flagged": False}

    try:
        async with httpx.AsyncClient(timeout=6) as client:
            res = await client.post(
                "https://api-inference.huggingface.co/models/meta-llama/Prompt-Guard-86M",
                headers={"Authorization": f"Bearer {token}"},
                json={"inputs": req.text[:512]},
            )
        if res.status_code != 200:
            return {"flagged": False}

        data = res.json()
        # Response: [[{"label": "INJECTION"|"JAILBREAK"|"BENIGN", "score": float}]]
        labels = data[0] if isinstance(data, list) and isinstance(data[0], list) else data
        for item in labels:
            if item.get("label") in ("INJECTION", "JAILBREAK") and item.get("score", 0) > 0.85:
                return {"flagged": True, "label": item["label"], "score": item["score"]}
        return {"flagged": False}
    except Exception:
        return {"flagged": False}
