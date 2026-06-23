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


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "ok"}


@app.post("/translate")
async def translate(req: TranslateRequest):
    target_code = LANG_CODES.get(req.target, req.target)
    if not target_code or req.target == "English":
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
