import os
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from deep_translator import GoogleTranslator

_nlp_en = None
def get_nlp():
    global _nlp_en
    if _nlp_en is None:
        import spacy
        _nlp_en = spacy.load("en_core_web_sm")
    return _nlp_en

_yake_extractor = None
def get_yake():
    global _yake_extractor
    if _yake_extractor is None:
        import yake
        _yake_extractor = yake.KeywordExtractor(
            lan="en", n=2, dedupLim=0.9, dedupFunc="seqm", windowsSize=1, top=30
        )
    return _yake_extractor

def ensure_nltk():
    import nltk
    for corpus in ("wordnet", "omw-1.4"):
        try:
            nltk.data.find(f"corpora/{corpus}")
        except LookupError:
            nltk.download(corpus, quiet=True)

ensure_nltk()

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


class ParseRequest(BaseModel):
    sentences: list[str]

class KeywordsRequest(BaseModel):
    text: str
    top_n: int = 25

class WordNetRequest(BaseModel):
    word: str
    pos: str = "NOUN"


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


@app.post("/parse")
async def parse_sentences(req: ParseRequest):
    nlp = get_nlp()
    results = []
    for sentence in req.sentences[:20]:
        doc = nlp(sentence[:400])
        tokens = [
            {
                "i": tok.i,
                "text": tok.text,
                "lemma": tok.lemma_,
                "pos": tok.pos_,
                "dep": tok.dep_,
                "head": tok.head.i,
                "is_stop": tok.is_stop,
            }
            for tok in doc
        ]
        results.append({"sentence": sentence, "tokens": tokens})
    return {"results": results}


@app.post("/keywords")
def extract_keywords(req: KeywordsRequest):
    extractor = get_yake()
    text = req.text[:10000]
    keywords = extractor.extract_keywords(text)[: req.top_n]
    if not keywords:
        return {"keywords": []}
    # YAKE: lower score = more relevant. Invert to [0,1] where 1.0 = most relevant.
    scores = [s for _, s in keywords]
    min_s, max_s = min(scores), max(scores)
    range_s = max_s - min_s if max_s > min_s else 1.0
    normalized = [
        {"word": kw, "score": round(1.0 - (s - min_s) / range_s, 4)}
        for kw, s in keywords
    ]
    return {"keywords": normalized}


@app.post("/wordnet")
def wordnet_lookup(req: WordNetRequest):
    import re
    from nltk.corpus import wordnet as wn
    word = req.word.strip()
    if not word or re.search(r"\s", word) or len(word) > 40:
        return {"words": []}
    pos_map = {"NOUN": wn.NOUN, "VERB": wn.VERB, "ADJ": wn.ADJ, "ADV": wn.ADV}
    pos = pos_map.get(req.pos.upper(), wn.NOUN)
    synsets = wn.synsets(word, pos=pos)[:3]
    if not synsets:
        return {"words": []}
    result = set()
    for synset in synsets:
        # Coordinate terms: siblings via shared hypernym
        for hypernym in synset.hypernyms()[:2]:
            for hyponym in hypernym.hyponyms()[:6]:
                for lemma in hyponym.lemmas():
                    w = lemma.name().replace("_", " ")
                    if w.lower() != word.lower() and " " not in w:
                        result.add(w)
        # Direct hyponyms
        for hyponym in synset.hyponyms()[:3]:
            for lemma in hyponym.lemmas():
                w = lemma.name().replace("_", " ")
                if w.lower() != word.lower() and " " not in w:
                    result.add(w)
        # Similar-to (adjectives)
        for similar in synset.similar_tos()[:3]:
            for lemma in similar.lemmas():
                w = lemma.name().replace("_", " ")
                if w.lower() != word.lower() and " " not in w:
                    result.add(w)
    words = [w for w in result if len(w) >= 3]
    return {"words": words[:20]}


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
