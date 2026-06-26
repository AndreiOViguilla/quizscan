// Rule-based quiz generator — no LLM calls; uses wink-nlp for POS/NER + spaCy (backend) for dep parsing
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import its from 'wink-nlp/src/its.js';
const wink = winkNLP(model);

// ── Stop words ───────────────────────────────────────────────────────────────
const STOP = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","and","but","or","nor","so","yet","to","of","in","on","at","by","for","with","about","into","from","up","out","over","then","once","also","as","if","while","because","since","although","though","unless","until","when","where","who","which","that","this","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","what","how","all","each","every","some","any","few","more","most","other","such","not","no","only","own","same","than","too","very","just","both","either","neither"]);

// Generic content words that make poor fill-in-the-blank targets
// Non-"-ly" adverbs/function words that inferPos can't detect by word shape.
// "-ly" adverbs (quickly, deeply, …) are caught dynamically by inferPos() instead.
const GENERIC_BLANK_WORDS = new Set([
  "used","made","came","took","went","said","told","knew","seen","given","called","known","found",
  "many","much","even","part","form","type","kind","ways","time","times","year","years","place",
  "area","world","people","person","thing","things","point","group","number","large","small",
  "long","high","great","well","good","often","later","early","during","within","between","among",
  "based","being","having","making","taking","using","getting","putting","coming","going","looking",
  "working","following","including","different","important","significant","various","several",
  "another","through","across","around","century","country","region","period","process","system",
  "level","term","terms","role","fact","case","way","use","need","also","even","back","just",
  "like","more","less","only","last","next","over","same","still","such","very","well","enough",
  // Irregular adverbs (no -ly suffix — not caught by inferPos)
  "always","never","usually","sometimes","rarely","often","frequently","generally","normally",
  "typically","commonly","occasionally","certainly","definitely","probably","possibly","perhaps",
  "maybe","likely","nearly","almost","quite","rather","already","yet","soon","once","twice",
  "again","too","further","however","therefore","thus","hence","instead","otherwise","meanwhile",
  "furthermore","additionally","consequently","accordingly","similarly","likewise","moreover",
  "anyway","elsewhere","everywhere","somewhere","anywhere","nowhere","then","now",
  // Reflexive pronouns — blanking a pronoun tests nothing about the source content
  "myself","yourself","himself","herself","themselves","itself","ourselves","yourselves",
]);

// Words that must never appear as MCQ distractors regardless of Datamuse context.
// rel_trg results can surface abuse/drug terms for innocent words like "child".
const DISTRACTOR_BLOCKLIST = new Set([
  "pornography","porn","abuse","rape","molestation","pedophilia",
  "cocaine","heroin","marijuana","methamphetamine","narcotics","drugs",
  "murder","killing","suicide","genocide","homicide","massacre",
  "prostitution","masturbation","orgasm","intercourse","nudity",
]);

// ── Datamuse response cache ───────────────────────────────────────────────────
const _datamuseCache = new Map();
const _datamuse429 = new Set(); // URLs that recently 429'd — skip until auto-cleared

// ── Inverted index for distractor proximity ranking ───────────────────────────
// Rebuilt on each generateNoAiQuiz call. Maps word → Set<lowercase sentence>.
// Lets rankDistractorsByProximity skip O(candidates × sentences × srcWords) scans.
let _invertedIndex = null;

async function fetchDatamuseCached(url, timeoutMs = 2500, retries = 1) {
  if (_datamuseCache.has(url)) return _datamuseCache.get(url);
  if (_datamuse429.has(url)) return [];
  if (_datamuseCache.size > 300) _datamuseCache.delete(_datamuseCache.keys().next().value);
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetch(url, signal ? { signal } : {});
    if (res.status === 429) {
      _datamuse429.add(url);
      setTimeout(() => _datamuse429.delete(url), 30000);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return fetchDatamuseCached(url, timeoutMs, retries - 1);
      }
      return [];
    }
    if (!res.ok) return [];
    const data = await res.json();
    _datamuseCache.set(url, data);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// ── Text cleaning ─────────────────────────────────────────────────────────────
function cleanText(raw) {
  return raw
    .replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    // Normalize dashes so "1937–1945" stays readable
    .replace(/[–—]/g, " - ")
    // Strip citation brackets [1], [12][13], [note 1]
    .replace(/\[[\w\s,;:.]+\]/g, "")
    // Strip Britannica/web UI artifacts
    .replace(/\b(IconBritannica|Britannica\s*AI|Ask\s*Anything|Quick\s*Summary|Top\s*Questions?|Related\s*Questions?|Main\s*article\s*:|See\s*also\s*:)/gi, "")
    // Strip "(Read Author's entry on X)" cross-references
    .replace(/\(Read\s[^)]{0,80}\)/gi, "")
    // Strip editor bylines: "Name Editors? Month DD, YYYY •Category"
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+Editors?\s+\w+\s+\d{1,2},\s+\d{4}/g, "")
    // Strip news bullets: "• 'headline' • Month DD, YYYY, H:MM PM ET (Source)"
    .replace(/•[^•\n]{0,120}(?:ET|PM|AM)\s*\([^)]{0,40}\)/g, "")
    // Remove CamelCase-merged words from copy-paste artifacts (e.g. "WarAmerican", "IIRelated")
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\s{2,}/g, " ").trim();
}

// ── Coreference Resolution ────────────────────────────────────────────────────
function resolveCoref(sentences, paraFirstSet = null) {
  let lastPerson = null;
  let lastPlural = null;
  let lastThing = null;

  return sentences.map((s, idx) => {
    // Reset antecedents at paragraph boundaries so pronouns can't reach across topics.
    if (paraFirstSet?.has(s) && idx > 0) {
      lastPerson = null; lastPlural = null; lastThing = null;
    }
    let resolved = s;

    if (lastPerson) {
      // Expand contractions first: "He's"/"She's" (= "He is") → "[Name] is"
      resolved = resolved.replace(/\b(He|She)'s\b/g, `${lastPerson} is`);
      // Possessive pronouns
      resolved = resolved.replace(/\b(His|Her)\b/g, `${lastPerson}'s`);
      // Subject/object pronouns (not followed by apostrophe)
      resolved = resolved.replace(/\b(He|She|Him)(?!')\b/g, lastPerson);
    }
    if (lastPlural) {
      resolved = resolved.replace(/\b(They|Them|Their)\b/g, (m, offset) => {
        const base = m.toLowerCase() === "their" ? `${lastPlural}'s` : lastPlural;
        return offset === 0 ? base.charAt(0).toUpperCase() + base.slice(1) : base;
      });
    }
    if (lastThing) {
      resolved = resolved.replace(/\bIt\b/g, lastThing);
    }

    // Update antecedent tracking from original sentence.
    // Critical: only update lastPerson when a genuine person entity is found.
    // A sentence like "In France, he signed..." must NOT overwrite lastPerson
    // with "France" — that would resolve the next He/She to a place name.
    const persons = s.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)?.filter(m => !STOP.has(m.toLowerCase())) || [];
    if (persons.length) {
      const multiWord = persons.find(p => {
        if (!/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(p)) return false;
        const t = detectEntityType(p);
        return t !== "place" && t !== "org";
      });
      if (multiWord) {
        lastPerson = multiWord;
      } else {
        const nonPlace = [...persons].reverse().find(p => {
          const t = detectEntityType(p);
          return t !== "place" && t !== "org";
        });
        if (nonPlace) lastPerson = nonPlace; // only update if a real person was found
      }
    }
    // Allow capitalized group nouns: "The Romans", "The Americans", "the soldiers"
    const pluralMatch = s.match(/\bThe\s+([A-Za-z][a-z]*s)\b/i);
    if (pluralMatch) lastPlural = pluralMatch[1];
    const thingMatch = s.match(/^([A-Z][A-Za-z\s]{2,25}?)\s+(?:is|was|has|had)\b/);
    if (thingMatch) {
      const thingSubj = thingMatch[1].trim();
      if (detectEntityType(thingSubj) !== "person") lastThing = thingSubj;
    }

    return resolved;
  });
}

// ── Sentence extraction + scoring ─────────────────────────────────────────────
function scoreSentence(s, idx, total, isParaFirst = false, rawS = s) {
  let score = 0;
  if (isParaFirst) score += 2;
  else if (idx < total * 0.2) score += 2;
  if (/\b(is|are|was|were|defined as|refers to|known as|called)\b/i.test(s)) score += 3;
  if (/\b\d{4}\b/.test(s)) score += 2;
  if (/\d+(\.\d+)?(%|million|billion|km|kg)/i.test(s)) score += 2;
  if (/\b[A-Z][a-z]{2,}/.test(s)) score += 1;
  if (/\b(because|therefore|thus|led to|caused|resulted in)\b/i.test(s)) score += 2;
  if (/\b(than|unlike|compared to|whereas|while)\b/i.test(s)) score += 1;
  if (/\b(founded|invented|discovered|created|established|wrote|built|led|won|defeated|conquered|signed|developed|introduced)\b/i.test(s)) score += 2;
  const wc = s.split(" ").length;
  if (wc < 8 || wc > 45) score -= 2;
  // Penalize sentences that ORIGINALLY started with a pronoun/demonstrative before coreference
  // resolution. Using rawS (pre-resolved) catches "This event led to..." which coref
  // can't fix, while not penalizing sentences whose He/She/They was successfully resolved.
  if (/^(This|These|Those|That|It\b|He\b|She\b|They\b)/.test(rawS)) score -= 2;
  // Bonus for sentences with a concrete proper-noun subject followed by a strong verb
  if (/^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3}\s+(was|is|were|are|had|has)\b/.test(s)) score += 1;
  // Penalize dialogue-heavy sentences — questions about who-said-what test reading, not comprehension
  if ((s.match(/"/g) || []).length >= 4) score -= 3;
  return score;
}

// Protect abbreviation periods so they don't trigger sentence splitting.
// Replaces the period in known abbreviations with \x02 (a control char never in normal text).
function protectAbbrev(text) {
  return text
    // Titles and honorifics: "Dr. Smith"
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Lt|Capt|Gen|Sgt|Cpl|Rev|Gov|Sen|Rep|Pres|Atty|Adm|Cmdr|Cpl|Pvt|Spc|Cdr)\.\s+(?=[A-Z])/g, '$1\x02 ')
    // Latin / academic: "e.g.", "i.e.", "et al.", "etc.", "vs.", "ibid.", "op. cit."
    .replace(/\b(e\.g|i\.e|et\sal|etc|vs|ibid|op\.cit|p\.s|a\.k\.a)\./gi, '$1\x02')
    // Geographic: "U.S.", "U.K.", "U.N." — single-letter sequences "X.Y.Z."
    .replace(/\b([A-Z])\.(?=[A-Z]\.)/g, '$1\x02')   // U.S.A → U\x02S\x02A
    .replace(/\b([A-Z])\.\s+(?=[A-Z])/g, '$1\x02 ') // J. K. Rowling → J\x02 K\x02 Rowling
    // Months abbreviated in dates: "Jan. 3"
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s+(?=\d)/g, '$1\x02 ')
    // Number abbreviations: "No. 1", "vol. 2", "p. 12"
    .replace(/\b(No|Vol|pp?|Ed|Fig|Eq|Sec|Ref|Dept|Govt|Approx|Est)\.\s+(?=\d)/gi, '$1\x02 ');
}
function restoreAbbrev(text) { return text.replace(/\x02/g, '.'); }

function extractSentences(text, { sorted = true, returnBoth = false } = {}) {
  const HAS_VERB = /\b(is|are|was|were|had|has|did|do|does|said|told|made|went|came|felt|looked|asked|moved|played|built|wrote|found|knew|wanted|liked|began|started|ended|called|named|liked|showed|gave|took|kept|left|put|got|set|ran|saw|thought|brought|bought|tried|heard|felt|stood|fell|held|grew|sent|met|led|read|lost|spent|born|raised|died|lived)\b/i;
  const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
  const SUBJECTIVE = /\b(i think|i believe|perhaps|maybe|it seems|many believe|some say|in my opinion|possibly|probably)\b/i;

  const cleaned = cleanText(text);
  const safeCleaned = protectAbbrev(cleaned);

  // Build set of paragraph-first sentences
  const paraFirstSet = new Set(
    safeCleaned
      .split(/\n{2,}/)
      .map(para => {
        const parts = para.split(/(?<=[.!?])\s+(?=[A-Z"(])/);
        return parts.length > 0 ? restoreAbbrev(parts[0].trim()) : "";
      })
      .filter(Boolean)
  );

  const raw = safeCleaned
    .split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map(s => restoreAbbrev(s.trim()))
    .map(s => s.trim())
    .filter(s => {
      if (s.length <= 35 || s.split(" ").length < 6) return false;
      // Reject sentences that are too long to make clean questions
      if (s.length > 350) return false;
      // Reject subjective/opinion sentences
      if (SUBJECTIVE.test(s)) return false;
      // Reject navigation/list-like text: >50% capitalized words and no verb
      const words = s.split(/\s+/);
      const capRatio = words.filter(w => /^[A-Z]/.test(w)).length / words.length;
      if (capRatio > 0.5 && !HAS_VERB.test(s)) return false;
      // Reject bibliography/reference entries
      if (/\b(pp?\.|ed\.|vol\.|ibid\.|et al\.|doi:|isbn:)/i.test(s)) return false;
      // Reject remaining citation-heavy sentences
      if ((s.match(/\[\d/g) || []).length >= 3) return false;
      // Reject FAQ-style question sentences (website "Related Questions" sections)
      if (/^(How|What|Who|Why|When|Where|Which)\s+\w.{5,}\?$/.test(s)) return false;
      // Reject sentences that depend on prior context to make sense
      if (/^(This|These|Those|Such|The former|The latter|The following|As mentioned|As noted|As described|As seen above|In this case|In that case|At this point|At that time)\b/i.test(s)) return false;
      // Reject sentences still containing web UI residue
      if (/\b(IconBritannica|Ask\s*Anything|Quick\s*Summary|Related\s*Questions?|Britannica\s*AI)\b/i.test(s)) return false;
      // Reject image caption fragments (pattern: "N of N [proper noun] [action verb]...")
      if (/^\d+\s+of\s+\d+\s+[A-Z]/.test(s)) return false;
      // Reject Wikipedia section-header concatenation artifacts.
      // Two patterns: lowercase→uppercase mid-word ("BackgroundCauses") and
      // Roman-numeral + capitalized word ("IIAftermath").
      if (s.split(/\s+/).some(w => {
        if (w.length <= 6) return false;
        if (/[a-z][A-Z]/.test(w) && !/^(Mc|Mac)[A-Z]/.test(w)) return true; // "BackgroundCauses"
        if (/[A-Z]{2}[a-z]/.test(w)) return true; // "IIAftermath"
        if (/\d[A-Z]/.test(w)) return true; // "1939Germany"
        return false;
      })) return false;
      return true;
    });
  const resolved = resolveCoref(raw, paraFirstSet);
  const scored = resolved.map((s, i) => ({ s, score: scoreSentence(s, i, resolved.length, paraFirstSet.has(raw[i]), raw[i]) }));
  if (returnBoth) {
    const ordered = scored.map(x => x.s);
    const sortedArr = [...scored].sort((a, b) => b.score - a.score).map(x => x.s);
    // Build POS pool in the same pass — no extra wink parse over all sentences
    const posPool = { NOUN: [], VERB: [], ADJ: [], ADV: [], PROPN: [] };
    scored.forEach(({ s }) => {
      wink.readDoc(s).tokens().each(t => {
        const pos = t.out(its.pos);
        if (!posPool[pos]) return;
        const val = t.out(its.value).toLowerCase();
        if (val.length < 4 || STOP.has(val) || GENERIC_BLANK_WORDS.has(val)) return;
        posPool[pos].push(val);
      });
    });
    for (const pos of Object.keys(posPool)) posPool[pos] = [...new Set(posPool[pos])];
    return { sorted: sortedArr, ordered, raw, posPool };
  }
  if (!sorted) return scored.map(x => x.s);
  return scored
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}

// ── TF-IDF ────────────────────────────────────────────────────────────────────
// Stem normalization applied at index time so "founded"/"founding"/"founder"
// all accumulate under the same key. This matches the fallback lookups in
// makeVocabContext and makeDoubleFill that already strip common suffixes.
function stem(w) {
  const s = w.replace(/(?:ers?|ing|ed|ly|ness|tion|sion|ment|ity)$/, "");
  return s.length >= 3 ? s : w;
}
function tfidf(sentences) {
  const docCount = sentences.length;
  const tf = sentences.map(s => {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w))
      .map(stem);
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return freq;
  });
  const df = {};
  tf.forEach(freq => Object.keys(freq).forEach(w => { df[w] = (df[w] || 0) + 1; }));
  const scores = {};
  tf.forEach(freq => {
    const len = Math.max(1, Object.values(freq).reduce((a, b) => a + b, 0));
    Object.entries(freq).forEach(([w, c]) => {
      scores[w] = (scores[w] || 0) + (c / len) * Math.log(docCount / (df[w] + 1));
    });
  });
  // Normalize to [0,1] so getSameFieldDistractors band filter works consistently
  // regardless of document length (short docs get tiny raw scores, long docs get large ones).
  const maxScore = Math.max(...Object.values(scores), 1);
  for (const w of Object.keys(scores)) scores[w] /= maxScore;
  return scores;
}

// ── Named entity detection ────────────────────────────────────────────────────
// Strip punctuation compromise sometimes attaches to entity strings
function cleanNlpToken(t) { return t.replace(/[^a-zA-Z\s'-]/g, '').trim(); }

function detectEntityType(term) {
  if (/^\d{4}$/.test(term)) return "year";
  if (/^\d/.test(term)) return "number";
  if (/^(Dr|Mr|Mrs|Ms|Prof|President|King|Queen|Sir|Gen|Lt|Capt|Lord|Lady|Sultan|Pope|Duke|Duchess|Count|Countess|Baron|Tsar|Empress|Emperor|Prince|Princess|Pharaoh|Chancellor|Archbishop|Bishop)\b/i.test(term)) return "person";
  if (/\b(City|Island|River|Mountain|Ocean|Sea|Lake|Street|Avenue|Republic|Kingdom|Empire|Province|State|County)\b/i.test(term)) return "place";
  if (/\b(University|College|Institute|Corporation|Company|Association|Organization|Department|Ministry|Agency|Committee|Council)\b/i.test(term)) return "org";
  return "noun";
}

function extractProperNouns(text) {
  // Group consecutive PROPN tokens into noun phrases using wink-nlp POS tags
  const doc = wink.readDoc(text);
  const phrases = [];
  let cur = [];
  doc.tokens().each(t => {
    if (t.out(its.pos) === 'PROPN') {
      cur.push(t.out(its.value));
    } else {
      if (cur.length) { phrases.push(cleanNlpToken(cur.join(' '))); cur = []; }
    }
  });
  if (cur.length) phrases.push(cleanNlpToken(cur.join(' ')));
  const named = phrases.filter(t => t.length > 3 && !STOP.has(t.toLowerCase()));
  const capFallback = (text.match(/\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3}/g) || [])
    .filter(m => !STOP.has(m.toLowerCase()) && m.length > 3);
  return [...new Set([...named, ...capFallback])];
}

function extractKeyTerm(sentence, tfidfScores) {
  const afterVerb = sentence.match(/\b(?:is|are|was|were|called|known as|defined as|refers to)\s+(?:a |an |the )?([A-Za-z][A-Za-z]+(?:\s+[A-Za-z]+){0,2})/);
  if (afterVerb) {
    let term = afterVerb[1].trim();
    if (/^[a-z]/.test(term)) term = term.split(/\s+/)[0];
    if (term.length >= 3 && !STOP.has(term.toLowerCase()) && !GENERIC_BLANK_WORDS.has(term.toLowerCase())) {
      // Reject adverbs, verbs, and auxiliaries — passive participles like "passed" or
      // "classed" are tagged VERB and make terrible blanks; only noun/adj complements qualify.
      let firstPos = null;
      wink.readDoc(term).tokens().each(t => { if (!firstPos) firstPos = t.out(its.pos); });
      if (firstPos !== 'ADV' && firstPos !== 'VERB' && firstPos !== 'AUX') return term;
    }
  }
  // Use wink-nlp PROPN tags to find proper noun phrases, preferring non-subject terms
  const subjectGuess = sentence.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+/)?.[1] || '';
  const wdoc = wink.readDoc(sentence);
  const allProper = [];
  let wphrCur = [];
  wdoc.tokens().each(t => {
    if (t.out(its.pos) === 'PROPN') {
      wphrCur.push(t.out(its.value));
    } else {
      if (wphrCur.length) {
        const p = cleanNlpToken(wphrCur.join(' '));
        if (p.length > 2 && !STOP.has(p.toLowerCase())) allProper.push(p);
        wphrCur = [];
      }
    }
  });
  if (wphrCur.length) {
    const p = cleanNlpToken(wphrCur.join(' '));
    if (p.length > 2 && !STOP.has(p.toLowerCase())) allProper.push(p);
  }
  const nonSubject = allProper.filter(t => t !== subjectGuess);
  const properPool = nonSubject.length ? nonSubject : allProper;
  if (properPool.length) {
    const scored = properPool.map(w => ({ w, s: tfidfScores[stem(w.toLowerCase())] || tfidfScores[w.toLowerCase()] || 0 })).sort((a, b) => b.s - a.s);
    return scored[0].w;
  }
  const num = sentence.match(/\b\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|percent|%|km|kg|m\b))?\b/i);
  if (num) return num[0];

  // TF-IDF fallback: pick the highest-scoring content word from this sentence.
  // Catches key nouns in scientific/technical texts (e.g. "photosynthesis", "mitochondria")
  // that have no proper noun and no number but are still the sentence's focal term.
  const tfidfFallback = (sentence.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
    .filter(w => !STOP.has(w) && !GENERIC_BLANK_WORDS.has(w) && inferPos(w, '') !== 'adv')
    .map(w => ({ w, score: tfidfScores[stem(w)] || tfidfScores[w] || 0 }))
    .filter(x => x.score > 0.2)
    .sort((a, b) => b.score - a.score)[0];
  if (tfidfFallback) return tfidfFallback.w;

  return null;
}

const VAGUE_SUBJECT = /^\b(one|some|this|that|any|many|such|another|other|each|every|various|it|there|here|the\s+following)\b/i;

// ── Definition Detection ──────────────────────────────────────────────────────
// Trim a definition string to the first natural clause boundary (max 8 words)
// so MCQ answer choices don't span multiple lines.
function trimDefinition(def) {
  const clauseEnd = def.search(/[,;]\s+(?:and|or|but|which|that|where|when|although|while|though|however|including|such as|especially|particularly|notably)/i);
  if (clauseEnd >= 20) {
    const trimmed = def.slice(0, clauseEnd).trim();
    // Only accept the clause-trim if it still forms a meaningful phrase (≥5 words)
    if (trimmed.split(" ").length >= 5) return trimmed;
  }
  const words = def.split(" ");
  return words.length > 9 ? words.slice(0, 9).join(" ") : def;
}

// Adjective/adverb words that can start a predicate-complement ("X is good enough for Y")
// but must never be mistaken for the opening of a definition noun phrase.
const DEF_ADJ_STARTS = new Set([
  "good","great","well","bad","old","new","young","big","small","long","short","high","low",
  "enough","too","quite","very","also","both","such","most","least","best","worst","better",
  "worse","more","less","rather","fairly","pretty","somewhat","known","named","called","said",
]);

function extractDefinition(sentence) {
  const defMatch = sentence.match(
    /^([A-Z][A-Za-z\s]{1,40}?)\s+(?:is|are|was|were|refers to|is defined as|is known as)\s+(?:a |an |the )?(.{10,})/
  );
  if (defMatch) {
    const subject = defMatch[1].trim();
    const definition = trimDefinition(defMatch[2].replace(/[.!?]+$/, "").trim());
    const defFirstWord = definition.split(" ")[0].toLowerCase();
    // Reject if the "definition" is actually a predicate adjective phrase, not a noun-phrase description
    if (DEF_ADJ_STARTS.has(defFirstWord)) return null;
    // Reject subjects ending with a preposition/conjunction — they're clause fragments, not nouns.
    const BAD_SUBJECT_ENDINGS = new Set(["the","a","an","of","in","on","at","by","and","or","but","its","their","with","which","that","who"]);
    if (BAD_SUBJECT_ENDINGS.has(subject.split(" ").at(-1).toLowerCase())) return null;
    if (subject.split(" ").length <= 4 && definition.split(" ").length >= 4 && !VAGUE_SUBJECT.test(subject)) return { subject, definition };
  }
  // "X is the term/name/word for Y" — encyclopedic definition pattern
  const termForMatch = sentence.match(
    /^([A-Z][A-Za-z\s]{1,40}?)\s+is\s+(?:the\s+)?(?:term|name|word|concept|process)\s+(?:for|used for|describing)\s+(?:a |an |the )?(.{10,})/
  );
  if (termForMatch) {
    const subject = termForMatch[1].trim();
    const definition = trimDefinition(termForMatch[2].replace(/[.!?]+$/, "").trim());
    if (subject.split(" ").length <= 4 && definition.split(" ").length >= 3) return { subject, definition };
  }
  return null;
}

// ── Cause & Effect Detection ──────────────────────────────────────────────────
function extractCauseEffect(sentence) {
  // "A because B" → "What was the reason that A?"
  const becauseM = sentence.match(/^(.{15,150}?)\s+because\s+(.{10,})$/i);
  if (becauseM) {
    const effect = becauseM[1].replace(/[.!?]+$/, "");
    let cause = becauseM[2].replace(/[.!?]+$/, "");
    // If the cause clause is a compound (joined by and/but/or), strip the tail
    // so the answer is a single clean clause rather than a run-on phrase.
    if (cause.split(/\s+/).length > 8) {
      const trimmed = cause.replace(/\s*,?\s+\b(and|but|or|yet|so)\b.+$/, "");
      if (trimmed.split(/\s+/).length >= 4) cause = trimmed;
    }
    return { question: `What was the reason that ${effect.charAt(0).toLowerCase() + effect.slice(1)}?`, answer: cause };
  }
  // "A, therefore/thus/hence B" → "What resulted from A?"
  const resultM = sentence.match(/^(.{10,150}?),?\s+(?:therefore|thus|hence|consequently|as a result)\s+(.{10,})$/i);
  if (resultM) {
    const cause = resultM[1].replace(/[.!?]+$/, "");
    const effect = resultM[2].replace(/[.!?]+$/, "");
    return { question: `What resulted from ${cause.charAt(0).toLowerCase() + cause.slice(1)}?`, answer: effect };
  }
  // "A led to/caused/resulted in B"
  const causedM = sentence.match(/^(.{10,150}?)\s+(?:led to|caused|resulted in|triggered|produced)\s+(.{10,})$/i);
  if (causedM) {
    const cause = causedM[1].replace(/[.!?]+$/, "");
    const effect = causedM[2].replace(/[.!?]+$/, "");
    return { question: `What did ${cause.charAt(0).toLowerCase() + cause.slice(1)} lead to?`, answer: effect };
  }
  return null;
}

// ── Sequence Detection ────────────────────────────────────────────────────────
function extractSequence(sentence) {
  // "After X, Y happened" — cap X at 60 chars to avoid giant questions
  const afterM = sentence.match(/^After\s+(.{5,60}?),\s+(.{10,})$/i);
  if (afterM) {
    return { question: `What happened after ${afterM[1].toLowerCase()}?`, answer: afterM[2].replace(/[.!?]+$/, "") };
  }
  // "X, then Y" — cap X at 60 chars
  const thenM = sentence.match(/^(.{10,60}?),?\s+then\s+(.{10,})$/i);
  if (thenM) {
    const step = thenM[1].replace(/[.!?]+$/, "");
    return { question: `What followed "${step}"?`, answer: thenM[2].replace(/[.!?]+$/, "") };
  }
  // "Before X, Y"
  const beforeM = sentence.match(/^Before\s+(.{5,60}?),\s+(.{10,})$/i);
  if (beforeM) {
    return { question: `What occurred before ${beforeM[1].toLowerCase()}?`, answer: beforeM[2].replace(/[.!?]+$/, "") };
  }
  return null;
}

// ── Comparison Detection ──────────────────────────────────────────────────────
function extractComparison(sentence) {
  // "X is [more/less/adj-er] than Y" → "What is [comparison] than Y?"
  const compM = sentence.match(
    /\b([A-Z][A-Za-z\s]{1,25}?)\s+(?:is|are|was|were)\s+((?:more |less )?\w+(?:er)?)\s+than\s+([A-Z][A-Za-z\s]{1,25})/
  );
  if (compM) {
    const subject = compM[1].trim();
    const comparative = compM[2].trim();
    const other = compM[3].trim().replace(/[.!?,]+$/, "");
    return { question: `What is ${comparative} than ${other}?`, answer: subject };
  }
  // "Unlike X, Y..." → "What is contrasted with X?" (answer = Y, short proper noun)
  const unlikeM = sentence.match(/^Unlike\s+([A-Z][A-Za-z\s]{1,30}?),\s+([A-Z][A-Za-z\s]{1,30}?)\s+/);
  if (unlikeM) {
    const other = unlikeM[1].trim();
    const subject = unlikeM[2].trim();
    return { question: `What is contrasted with ${other} in the passage?`, answer: subject };
  }
  return null;
}

// ── NLP-based wh-question fallback (wink-nlp) ────────────────────────────────
// Fires when all regex patterns in toWhQuestion fail. Uses wink-nlp POS tagging
// + lemmatization to handle any action verb without a hardcoded list.
const SKIP_VERB_BASE = /^(be|is|are|was|were|have|has|had|do|does|did|will|would|could|should|may|might|shall|can|seem|appear|become|remain|feel|look|sound|get|stay|turn|go|come|keep|let|make|help|know|think|say|tell|want|need|see|find|give|take|use|show|call|try|ask|work|move|live|die|stand|fall|hold|grow|send|meet|lead|read|lose|spend|run|start|end|begin|stop|change|follow|include|contain|involve|require|allow|support|provide)$/;

function toWhQuestionNlp(sentence) {
  // Subject must be a proper noun sequence at the sentence start
  const subjectM = sentence.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+/);
  if (!subjectM) return null;
  const subject = subjectM[1].trim();
  if (subject.length < 2 || STOP.has(subject.toLowerCase())) return null;

  const rest = sentence.slice(subject.length).trim();
  // Find the first VERB token and get its lemma via wink-nlp
  const rdoc = wink.readDoc(rest);
  let verbText = null, verbLemma = null;
  rdoc.tokens().each(t => {
    if (!verbText && t.out(its.pos) === 'VERB') {
      verbText = t.out(its.value);
      verbLemma = t.out(its.lemma) || verbText;
    }
  });
  if (!verbText) return null;
  if (SKIP_VERB_BASE.test(verbLemma.toLowerCase())) return null;

  const verbIdx = rest.indexOf(verbText);
  const afterVerb = rest.slice(verbIdx + verbText.length).trim().replace(/[.!?]+$/, '');
  if (!afterVerb || afterVerb.length < 3) return null;

  const obj = afterVerb
    .replace(/\s+(?:in|at|on|by|from|to|with|during|after|before|for|into|upon|within|toward|under|over|around|against|along|behind|beyond|near|since|until|through)\s+.*/i, '')
    .replace(/\s+\d{4}\b.*/, '')
    .replace(/[,;:.!?]+$/, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();

  if (!obj || obj.length < 3 || STOP.has(obj.toLowerCase())) return null;
  if (GENERIC_BLANK_WORDS.has(obj.toLowerCase())) return null;
  if (obj.split(' ').length > 7) return null;

  const question = `What did ${subject} ${verbLemma}?`;
  if (!questionOk(question)) return null;
  return { question, answer: obj, type: 'noun' };
}

// ── spaCy dependency parse → questions (Python backend) ──────────────────────
async function parseWithSpacy(sentences) {
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl) return [];
  try {
    const res = await fetch(`${backendUrl}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch { return []; }
}

// valhalla/t5-base-qg-hl question generation — fires speculatively in mixed mode,
// awaited only if the rule-based pool is thin. Answer is extracted here so the model
// only needs to write a natural question around the highlighted span.
let _flan429Until = 0;
async function fetchFlanQuestions(sentences, tfidfScores) {
  if (!sentences.length || Date.now() < _flan429Until) return [];
  // Build {sentence, answer} pairs — model needs both to generate a targeted question
  const items = sentences.slice(0, 8).map(s => {
    const answer = extractKeyTerm(s, tfidfScores);
    return answer ? { sentence: s, answer } : null;
  }).filter(Boolean);
  if (!items.length) return [];
  try {
    const res = await fetch('/api/flan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    if (res.status === 429) { _flan429Until = Date.now() + 60_000; return []; }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : [];
  } catch { return []; }
}

// YAKE statistical keyphrase extraction — returns [{word, score}] where score ∈ [0,1], higher = more relevant.
// Fires concurrently with neural re-ranking so it adds no latency to the pipeline.
async function fetchBackendKeywords(text) {
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl) return [];
  try {
    const res = await fetch(`${backendUrl}/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 10000), top_n: 25 }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.keywords) ? data.keywords : [];
  } catch { return []; }
}

// NLTK WordNet via backend — coordinate terms (siblings in the WordNet hierarchy).
// Preferred over direct en-word.net calls: no CSP issues, more reliable on Render.
const _wordNetBackendCache = new Map();
async function fetchWordNetBackend(word, pos = 'NOUN') {
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl || !word || /\s/.test(word) || word.length > 40) return [];
  const cacheKey = `${word}:${pos}`;
  if (_wordNetBackendCache.has(cacheKey)) return _wordNetBackendCache.get(cacheKey);
  try {
    const res = await fetch(`${backendUrl}/wordnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, pos }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const words = Array.isArray(data.words) ? data.words : [];
    _wordNetBackendCache.set(cacheKey, words);
    return words;
  } catch { return []; }
}

function makeDepParseQuestion(parseResult) {
  const { sentence, tokens } = parseResult;
  const root = tokens.find(t => t.dep === 'ROOT' && t.pos === 'VERB');
  if (!root || SKIP_VERB_BASE.test(root.lemma.toLowerCase())) return null;

  // Passive: "X was founded by Y" → "Who founded X?"
  const passSubj = tokens.find(t => t.dep === 'nsubjpass' && t.head === root.i);
  if (passSubj) {
    const agentPrep = tokens.find(t => t.dep === 'agent' && t.head === root.i);
    const agent = agentPrep ? tokens.find(t => t.dep === 'pobj' && t.head === agentPrep.i) : null;
    if (agent && !STOP.has(agent.text.toLowerCase())) {
      const agentPhrase = tokens
        .filter(t => t.head === agent.i && t.dep === 'compound')
        .concat(agent).sort((a, b) => a.i - b.i).map(t => t.text).join(' ');
      const q = `Who ${root.text.toLowerCase()} ${passSubj.text}?`;
      if (!questionOk(q)) return null;
      return { question: q, answer: agentPhrase, type: 'person', sentence };
    }
    return null;
  }

  // Active: "Marie Curie discovered radioactivity" → "What did Marie Curie discover?"
  const subj = tokens.find(t => t.dep === 'nsubj' && t.head === root.i);
  if (!subj || STOP.has(subj.text.toLowerCase())) return null;
  const dobj = tokens.find(t => (t.dep === 'dobj' || t.dep === 'obj') && t.head === root.i);
  if (!dobj || STOP.has(dobj.text.toLowerCase()) || GENERIC_BLANK_WORDS.has(dobj.text.toLowerCase())) return null;

  const build = head => tokens
    .filter(t => t.head === head.i && (t.dep === 'compound' || t.dep === 'amod'))
    .concat(head).sort((a, b) => a.i - b.i).map(t => t.text).join(' ');

  const subjPhrase = build(subj);
  const objPhrase = build(dobj).replace(/^(the|a|an)\s+/i, '').trim();
  if (!objPhrase || objPhrase.length < 3 || objPhrase.split(' ').length > 6) return null;
  if (GENERIC_BLANK_WORDS.has(objPhrase.toLowerCase())) return null;

  const q = `What did ${subjPhrase} ${root.lemma}?`;
  if (!questionOk(q)) return null;
  return { question: q, answer: objPhrase, type: 'noun', sentence };
}

function makeDepParseQuestions(parseResults, allTerms, usedSentences, posPool = null, tfidfScores = {}, sentences = []) {
  const out = [];
  for (const result of parseResults) {
    const q = makeDepParseQuestion(result);
    if (!q || usedSentences.has(q.sentence)) continue;
    const sTerms = extractProperNouns(q.sentence);
    let distractors = getDistractors(q.answer, allTerms, q.type, sTerms, posPool, tfidfScores, sentences, q.sentence);
    distractors = normalizeLengthDistribution(q.answer, distractors);
    usedSentences.add(q.sentence);
    if (distractors.length >= 3) {
      const choices = shuffle([q.answer, ...distractors.slice(0, 3)]);
      out.push({ type: 'mcq', question: q.question, choices, answer: choices.indexOf(q.answer), difficulty: 'medium', explanation: `From source: "${q.sentence}"` });
    } else {
      out.push({ type: 'fill', question: q.question, answer: q.answer, difficulty: 'medium', explanation: `From source: "${q.sentence}"` });
    }
  }
  return out;
}

// ── Wh-question generation ────────────────────────────────────────────────────
function toWhQuestion(sentence) {
  const personSubject = sentence.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(was|is|were|are|had|has|did|became|founded|invented|discovered|wrote|created|built|led|won|lost)/);
  if (personSubject) {
    const subject = personSubject[1].trim();
    const rest = sentence.slice(subject.length).trim();
    // Use "Who" only for person entities; use "What" for places, orgs, or abstract things
    const entityType = detectEntityType(subject);
    const qWord = entityType === "person" ? "Who" : "What";
    const type = entityType === "person" ? "person" : "noun";
    return { question: `${qWord} ${rest.replace(/[.!?]+$/, "")}?`, answer: subject, type };
  }
  // "X founded/invented/created/built/wrote/developed [proper-noun object]"
  const actionMatch = sentence.match(/^([A-Z][A-Za-z\s]{2,35}?)\s+(founded|invented|created|built|wrote|developed|established|introduced|designed|discovered|published|directed|composed|painted|sculpted|passed|signed|ratified|defeated|conquered|captured|elected|appointed|awarded|named|proposed|formulated|coined|solved|produced|launched|formed|organized)\s+(?:the\s+|a\s+|an\s+)?([A-Z][A-Za-z\s]{2,40})/);
  if (actionMatch) {
    const subject = actionMatch[1].trim();
    const verb = actionMatch[2].toLowerCase();
    const obj = actionMatch[3].trim().replace(/[.!?,]+$/, "");
    if (obj.length >= 3 && !STOP.has(obj.toLowerCase())) {
      return { question: `What did ${subject} ${verb}?`, answer: obj, type: "noun" };
    }
  }
  // Passive: "X was/were [action] by Y" → "Who [actioned] X?"
  const passiveByMatch = sentence.match(/^([A-Z][A-Za-z\s,]{2,60}?)\s+(?:was|were)\s+(founded|invented|created|written|built|established|designed|discovered|introduced|developed|passed|enacted|signed|ratified|published|released|produced|directed|composed|painted|sculpted|elected|appointed|defeated|conquered|captured|led|commanded|awarded|granted|named|called|described|defined|coined|proposed|formulated|solved)\s+by\s+([A-Z][A-Za-z\s]{2,40})/);
  if (passiveByMatch) {
    const obj = passiveByMatch[1].trim();
    const verb = passiveByMatch[2].toLowerCase();
    const agent = passiveByMatch[3].trim().replace(/[.!?,]+$/, "");
    if (agent.length >= 3 && obj.split(" ").length <= 6) {
      return { question: `Who ${verb} ${obj}?`, answer: agent, type: "person" };
    }
  }
  // Appositive: "Darwin, a British naturalist, ..." → "What was Darwin?"
  const appositiveMatch = sentence.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}),\s+(?:a|an)\s+([A-Za-z][A-Za-z\s]{3,50}?),\s+/);
  if (appositiveMatch) {
    const subject = appositiveMatch[1].trim();
    const description = appositiveMatch[2].trim();
    const wc = description.split(" ").length;
    if (wc >= 1 && wc <= 6 && !STOP.has(description.split(" ").at(-1).toLowerCase())) {
      return { question: `What was ${subject}?`, answer: description, type: "noun" };
    }
  }
  // Acronym expansion: "ATP (adenosine triphosphate)" → "What does ATP stand for?"
  const acronymMatch = sentence.match(/\b([A-Z]{2,6})\s+\(([A-Za-z][A-Za-z\s-]{4,50})\)/);
  if (acronymMatch) {
    return { question: `What does ${acronymMatch[1]} stand for?`, answer: acronymMatch[2].trim(), type: "noun" };
  }
  // "Known for": "Mozart is known for his piano concertos" → "What is Mozart known for?"
  const knownForMatch = sentence.match(/^([A-Z][A-Za-z\s]{2,40}?)\s+(?:is|was|are|were)\s+(?:best\s+)?known\s+for\s+(.{8,80})/);
  if (knownForMatch) {
    const subject = knownForMatch[1].trim();
    const reason = knownForMatch[2].replace(/[.!?,]+$/, "").trim();
    const wc = reason.split(" ").length;
    if (wc >= 2 && wc <= 8) {
      return { question: `What is ${subject} known for?`, answer: reason, type: "noun" };
    }
  }
  const allYears = [...sentence.matchAll(/\b(1[3-9]\d{2}|20[0-2]\d)\b/g)];
  // Require a temporal preposition or sentence-start position — prevents bare quantities
  // like "2048 soldiers" or phone numbers from triggering the year question branch.
  const yearMatch = sentence.match(/\b(in|by|until|during|since|after|before|around|from)?\s*(1[3-9]\d{2}|20[0-2]\d)\b/i);
  if (yearMatch && allYears.length === 1) {
    const before = sentence.slice(0, sentence.indexOf(yearMatch[0]));
    const monthPrecedes = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{0,2}\s*$/.test(before);
    // When no preposition is present, yearMatch[0] includes the leading space consumed
    // by \s* — the replacement must include a leading space to avoid "Februarywhat year".
    const replacement = yearMatch[1] ? "in what year" : monthPrecedes ? " of what year" : " what year";
    const q = sentence.replace(yearMatch[0], replacement).replace(/[.!?]+$/, "");
    return { question: q.charAt(0).toUpperCase() + q.slice(1) + "?", answer: yearMatch[2], type: "year" };
  }
  const placeMatch = sentence.match(/\b(?:in|at|near|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (placeMatch && detectEntityType(placeMatch[1]) !== "noun") {
    const q = sentence.replace(placeMatch[0], `where`).replace(/[.!?]+$/, "");
    return { question: q.charAt(0).toUpperCase() + q.slice(1) + "?", answer: placeMatch[1], type: "place" };
  }
  const numMatch = sentence.match(/\b(\d[\d,]*)\s+(?!percent|%|January|February|March|April|May|June|July|August|September|October|November|December)/);
  if (numMatch) {
    // Skip day-of-month: "September 3", "August 23 - 24"
    const beforeNum = sentence.slice(0, sentence.indexOf(numMatch[0]));
    const monthBefore = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+$/i.test(beforeNum);
    if (monthBefore) return null;
    const q = sentence.replace(numMatch[1], "how many").replace(/[.!?]+$/, "");
    return { question: q.charAt(0).toUpperCase() + q.slice(1) + "?", answer: numMatch[1], type: "number" };
  }
  // NLP fallback: handles any action verb with a proper-noun subject
  return toWhQuestionNlp(sentence);
}

// ── POS-tagged word pool ──────────────────────────────────────────────────────

function getDistractorsByPos(answer, posPool, count = 3) {
  const tokens = [];
  wink.readDoc(answer).tokens().each(t => tokens.push({ pos: t.out(its.pos), val: t.out(its.value) }));
  // Head = last NOUN or PROPN; fall back to last token so multi-word phrases like
  // "ancient Rome" resolve to PROPN rather than the leading adjective.
  const head = [...tokens].reverse().find(t => t.pos === 'NOUN' || t.pos === 'PROPN') || tokens.at(-1);
  const answerPos = head?.pos;
  if (!answerPos || !posPool[answerPos]) return [];
  const candidates = posPool[answerPos].filter(w => w !== answer.toLowerCase() && !STOP.has(w));
  return shuffle(candidates).slice(0, count);
}

// ── Distractor helpers ────────────────────────────────────────────────────────

// Score each candidate by how many sentences contain it AND a word from the source sentence.
// Higher score = more topically proximate = harder for students to eliminate by topic.
// Uses _invertedIndex when available: first collects the union of sentences that share
// any source word (fast Set lookup), then checks each candidate against that small set
// instead of scanning all sentences.
function rankDistractorsByProximity(candidates, sourceSentence, sentences) {
  const srcWords = sourceSentence.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

  if (_invertedIndex) {
    // Union of all sentences that contain at least one source word
    const srcSentUnion = new Set();
    for (const w of srcWords) {
      const ws = _invertedIndex[w];
      if (ws) for (const sl of ws) srcSentUnion.add(sl);
    }
    return candidates
      .map(c => {
        const cLow = c.toLowerCase();
        let coScore = 0;
        for (const sl of srcSentUnion) if (sl.includes(cLow)) coScore++;
        return { c, coScore };
      })
      .sort((a, b) => b.coScore - a.coScore)
      .map(x => x.c);
  }

  // Fallback when index hasn't been built yet
  const sentLows = sentences.map(s => s.toLowerCase());
  return candidates
    .map(c => {
      const cLow = c.toLowerCase();
      const coScore = sentLows.filter(sLow =>
        sLow.includes(cLow) && srcWords.some(w => sLow.includes(w))
      ).length;
      return { c, coScore };
    })
    .sort((a, b) => b.coScore - a.coScore)
    .map(x => x.c);
}

// Prefer distractors within ±1 word-count of the answer, so the correct answer
// can't be identified by being the longest/shortest choice.
function normalizeLengthDistribution(answer, distractors) {
  if (!distractors.length) return distractors;
  const aLen = answer.split(/\s+/).length;
  const lenMatched = distractors.filter(d => Math.abs(d.split(/\s+/).length - aLen) <= 1);
  if (lenMatched.length >= 3) return shuffle(lenMatched).slice(0, 3);
  return [...distractors].sort((a, b) =>
    Math.abs(a.split(/\s+/).length - aLen) - Math.abs(b.split(/\s+/).length - aLen)
  ).slice(0, 3);
}

// Distractors that share TF-IDF "tier" with the answer are in the same semantic field.
function getSameFieldDistractors(answer, allTerms, tfidfScores, count = 6) {
  const answerScore = tfidfScores[stem(answer.toLowerCase())] || 0;
  if (!answerScore) return shuffle(allTerms.filter(t => t !== answer)).slice(0, count);
  const sameField = allTerms
    .filter(t => t !== answer && t.length > 2)
    .map(t => ({ t, score: tfidfScores[stem(t.toLowerCase())] || 0 }))
    .filter(({ score }) => score > answerScore * 0.3 && score < answerScore * 3)
    .sort((a, b) => Math.abs(a.score - answerScore) - Math.abs(b.score - answerScore))
    .map(({ t }) => t);
  return sameField.length >= count ? shuffle(sameField).slice(0, count)
    : shuffle(allTerms.filter(t => t !== answer)).slice(0, count);
}

// Reject questions where context words in the stem give the answer away.
// Score = fraction of non-stop content words in the question that overlap with the answer.
function computeLeakageScore(question, answer) {
  const answerWords = answer.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
  if (!answerWords.length) return 0;
  const headWord = answerWords.at(-1);
  const qWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
  const qWordSet = new Set(qWords);
  const qStemSet = new Set(qWords.map(stem));
  let leakScore = 0;
  for (const aw of answerWords) {
    // Exact match OR stem match ("conquered" in Q with "conquest" as answer)
    if (qWordSet.has(aw) || qStemSet.has(stem(aw))) leakScore += aw === headWord ? 2 : 1;
  }
  return leakScore / (1 + answerWords.length);
}

const _embeddingCache = new Map();
let _embed429Until = 0;
let _embedInFlight = 0;
const _EMBED_MAX_CONCURRENT = 2;

async function getEmbeddingsCached(words) {
  const uncached = words.filter(w => !_embeddingCache.has(w));
  if (uncached.length) {
    if (_embeddingCache.size > 500) _embeddingCache.delete(_embeddingCache.keys().next().value);
    if (Date.now() < _embed429Until || _embedInFlight >= _EMBED_MAX_CONCURRENT) {
      return words.map(w => _embeddingCache.get(w) || null);
    }
    _embedInFlight++;
    try {
      const res = await fetch('/api/embed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: uncached }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      if (res.status === 429) {
        _embed429Until = Date.now() + 30_000;
      } else if (res.ok) {
        const { embeddings } = await res.json();
        if (embeddings?.length === uncached.length) {
          uncached.forEach((w, i) => _embeddingCache.set(w, embeddings[i]));
        }
      }
    } catch {} finally {
      _embedInFlight--;
    }
  }
  return words.map(w => _embeddingCache.get(w) || null);
}

// Filter distractors that are too semantically similar to the answer (near-synonyms).
// Uses a module-level embedding cache so repeated words across questions share lookups.
async function filterDistractorsBySimilarity(answer, candidates, maxSimilarity = 0.82) {
  if (!candidates.length) return candidates;
  const allWords = [answer, ...candidates.slice(0, 10)];
  const embeddings = await getEmbeddingsCached(allWords);
  const answerEmb = embeddings[0];
  if (!answerEmb) return candidates;
  return candidates.filter((_, i) => {
    const emb = embeddings[i + 1];
    if (!emb) return true;
    const sim = cosineSimilarity(answerEmb, emb);
    return sim < maxSimilarity && sim > 0.15;
  });
}

// WordNet via Open English WordNet REST API — free, no key, returns coordinate terms
// (same-level words like oak→elm→pine) which are ideal distractors.
async function fetchWordNetDistractors(word, pos) {
  if (!word || /\s/.test(word) || word.length > 40) return [];

  // Prefer backend NLTK WordNet — more reliable, no additional CSP concerns
  const backendWords = await fetchWordNetBackend(word, pos || 'NOUN');
  if (backendWords.length) {
    return backendWords
      .map(w => w.toLowerCase())
      .filter(w => w !== word.toLowerCase() && !w.includes(' ') && w.length >= 3 && !DISTRACTOR_BLOCKLIST.has(w));
  }

  // Fallback: proxy via /api/lookup?service=wordnet — server-side, no CORS issues
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined;
    const r = await fetch(
      `/api/lookup?service=wordnet&word=${encodeURIComponent(word)}&pos=${encodeURIComponent(pos || 'NOUN')}`,
      { signal }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (data.words || []).filter(w => !DISTRACTOR_BLOCKLIST.has(w.toLowerCase()));
  } catch { return []; }
}

// ── Smart distractor generation ───────────────────────────────────────────────
// sentenceTerms: proper nouns from the same sentence — used first as more believable wrong answers
function getDistractors(answer, allTerms, type, sentenceTerms = [], posPool = null, tfidfScores = {}, sentences = [], sourceSentence = "") {
  if (type === "year") {
    const y = parseInt(answer);
    const maxY = new Date().getFullYear();
    // Prefer years that actually appear elsewhere in the text — they're contextually
    // plausible to a student who read the passage, unlike fixed ±delta values.
    const textYears = [...new Set([...allTerms, ...sentenceTerms])]
      .filter(t => /^\d{4}$/.test(t) && parseInt(t) !== y && parseInt(t) > 1000 && parseInt(t) <= maxY);
    // Sort by proximity to the correct year — closest years are hardest to distinguish.
    if (textYears.length >= 3) return textYears.sort((a, b) => Math.abs(parseInt(a) - y) - Math.abs(parseInt(b) - y)).slice(0, 3);
    const computed = shuffle([y - 3, y + 3, y - 8, y + 8, y - 15, y + 15, y - 25, y + 25]
      .filter(n => n !== y && n > 1000 && n <= maxY)).map(String);
    return [...new Set([...textYears, ...computed])].slice(0, 3);
  }
  if (type === "number") {
    const n = parseFloat(answer.replace(/,/g, ""));
    const d = Math.max(1, Math.round(n * 0.15)); // ±15% delta for less patterned distractors
    return shuffle([Math.round(n * 0.5), Math.round(n * 0.75), Math.round(n + d), Math.round(n - d), Math.round(n * 1.5)]
      .filter(x => x > 0 && x !== n))
      .slice(0, 3).map(String);
  }
  // Common-noun answers: return [] so callers use Datamuse for semantically relevant distractors
  if (/^[a-z]/.test(answer)) return [];
  // Prefer same-sentence terms as contextually believable distractors
  const sameS = sentenceTerms.filter(t => t !== answer && t.length > 2);
  if (type === "person") {
    const pool = [...new Set([...sameS, ...allTerms])].filter(t => t !== answer);
    const fullNames = pool.filter(t => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t));
    const singleNames = pool.filter(t => /^[A-Z][a-z]{2,}$/.test(t) && detectEntityType(t) !== "place" && detectEntityType(t) !== "org");
    const people = [...new Set([...fullNames, ...singleNames])];
    if (people.length >= 3) return shuffle(people).slice(0, 6);
  }
  if (type === "place") {
    const places = [...new Set([...sameS, ...allTerms])].filter(t => detectEntityType(t) === "place" && t !== answer);
    if (places.length >= 3) return shuffle(places).slice(0, 6);
  }
  if (sameS.length >= 3) return shuffle(sameS).slice(0, 6);
  const targetType = detectEntityType(answer);
  if (targetType !== "noun") {
    const sameType = allTerms.filter(t => t !== answer && t.length > 2 && detectEntityType(t) === targetType);
    if (sameType.length >= 3) return shuffle(sameType).slice(0, 6);
    return [];
  }
  // For noun-type answers: try TF-IDF same-field distractors, ranked by topic proximity,
  // then POS-matched pool as final fallback.
  const fieldPool = getSameFieldDistractors(answer, allTerms, tfidfScores);
  const ranked = sentences.length && sourceSentence
    ? rankDistractorsByProximity(fieldPool, sourceSentence, sentences)
    : fieldPool;
  if (ranked.length >= 3) return ranked.slice(0, 6);
  if (posPool) {
    const posMatched = getDistractorsByPos(answer, posPool);
    if (posMatched.length >= 3) return posMatched.slice(0, 6);
  }
  return shuffle(allTerms.filter(t => t !== answer && t.length > 2)).slice(0, 6);
}

// ── Better T/F — Named Entity Swapping ───────────────────────────────────────
function negateSentence(sentence, allEntities) {
  const entities = extractProperNouns(sentence);
  const swappable = entities.filter(e => allEntities.some(a => a !== e));
  if (swappable.length > 0) {
    const target = swappable[Math.floor(Math.random() * swappable.length)];
    const targetType = detectEntityType(target);
    // Prefer same-type replacement (person↔person, place↔place) for believable false statements
    const sameType = allEntities.filter(a => a !== target && detectEntityType(a) === targetType);
    const replacement = sameType.length > 0
      ? shuffle(sameType)[0]
      : shuffle(allEntities.filter(a => a !== target))[0];
    if (replacement) return sentence.replace(target, replacement);
  }
  // Swap ordinals before falling back to year/number changes — more naturally-sounding false statements
  // Richer swap table — avoids the predictable first↔second tell that students learn.
  // Semantically grounded pairs (primary/central/leading) are harder to spot mechanically.
  const ORDINAL_SWAPS = {
    first: "third", second: "first", third: "second", fourth: "third", fifth: "fourth",
    primary: "secondary", central: "peripheral", leading: "following",
    major: "minor", key: "peripheral", main: "secondary",
    earliest: "latest", latest: "earliest", largest: "smallest", smallest: "largest",
    last: "first",
  };
  const ordinalM = sentence.match(/\b(first|second|third|fourth|fifth|primary|central|leading|major|key|main|earliest|latest|largest|smallest|last)\b/i);
  if (ordinalM) {
    const swap = ORDINAL_SWAPS[ordinalM[1].toLowerCase()];
    if (swap) {
      const replacement = ordinalM[1][0] === ordinalM[1][0].toUpperCase()
        ? swap.charAt(0).toUpperCase() + swap.slice(1) : swap;
      return sentence.slice(0, ordinalM.index) + replacement + sentence.slice(ordinalM.index + ordinalM[0].length);
    }
  }
  const yearMatch = sentence.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    return sentence.replace(yearMatch[0], String(Math.random() > 0.5 ? y + 5 : y - 5));
  }
  const numMatch = sentence.match(/\b(\d+)\b/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    const delta = Math.max(1, Math.ceil(n * 0.4));
    return sentence.replace(numMatch[0], String(Math.random() > 0.5 ? n + delta : Math.max(1, n - delta)));
  }
  const verbMatch = sentence.match(/\b(is|are|was|were)\b/i);
  // Only add "not" if the sentence doesn't already contain one — prevents "not not" double negation
  if (verbMatch && !/\bnot\b/i.test(sentence)) return sentence.replace(verbMatch[0], `${verbMatch[0]} not`);
  return null;
}

// ── Embedded-clause stripper ─────────────────────────────────────────────────
// Removes non-restrictive relative/participial clauses surrounded by commas so
// that the main subject+verb lands adjacent, letting toWhQuestion match more sentences.
// E.g. "Napoleon, who was born in Corsica, became Emperor" → "Napoleon became Emperor"
function stripEmbeddedClauses(s) {
  return s
    .replace(/,\s+who\s+[^,]{5,80},\s+/g, ' ')
    .replace(/,\s+which\s+[^,]{5,80},\s+/g, ' ')
    .replace(/,\s+a\s+[^,]{5,60},\s+/g, ' ')    // appositive: "Darwin, a naturalist, ..."
    .replace(/,\s+an\s+[^,]{5,60},\s+/g, ' ')
    .replace(/,\s+the\s+[^,]{5,60},\s+/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── Answer trimmer ────────────────────────────────────────────────────────────
function trimAnswer(text, maxLen = 80) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function questionOk(q) {
  if (typeof q !== "string" || q.length < 10 || q.length > 250) return false;
  if (/\b(undefined|null)\b/.test(q)) return false;
  if (/^[a-z]/.test(q)) return false;
  // Reject NLP artifacts: "did ... have been" mixed tense (e.g. "What did Many men have been named?")
  if (/\bdid\b.+\bhave been\b/.test(q)) return false;
  // Reject sentences that are clearly truncated mid-dialogue (end on a lone question word)
  if (/\b(What|Who|When|Where|Why|How)\s*$/.test(q)) return false;
  // Coref failure: "What did the/it/he/she/they do?" — stop-word subject
  if (/^What did (the|a|an|it|this|that|they|he|she)\b/i.test(q)) return false;
  // Past-tense leaked into did-question: "What did X founded/wrote?"
  if (/^What did .+\b(was|were|had|has|is|are|been|founded|invented|created|wrote|built)\?$/.test(q)) return false;
  // Implausibly trivial: "Who is X?" / "What was Y?" with a 1-2 char answer baked in
  if (/^(Who|What) (is|was|are|were) \w{1,2}\?$/.test(q)) return false;
  // Truncated / trailing punctuation before the question mark
  if (/[,:;]\s*\?$/.test(q)) return false;
  // Repeated consecutive words ("the the", "was was")
  if (/\b(\w+)\s+\1\b/i.test(q)) return false;
  return true;
}

// ── Diversity-aware question picker ──────────────────────────────────────────
// Round-robins across question subtypes so the final quiz isn't a run of same-format questions.
// MCQ questions are split into subtypes (wh, definition, KWIC, contrast, pronoun…) so
// 4 wh-questions never appear consecutively even though all have type === "mcq".
function getQuestionSubtype(q) {
  if (q.type !== 'mcq') return q.type;
  const qt = q.question;
  if (/^(Choose the correct answer|Fill in the blank):/.test(qt)) return 'mcq_kwic';
  if (/^What is described as/.test(qt)) return 'mcq_def';
  if (/^Which sentence best states/.test(qt)) return 'mcq_main';
  if (/^Which concept is most associated/.test(qt)) return 'mcq_cooc';
  if (/who does .+ refer to/i.test(qt)) return 'mcq_pronoun';
  if (/^According to the passage, what is contrasted/.test(qt)) return 'mcq_contrast';
  if (/^Which of the following was NOT/.test(qt)) return 'mcq_list';
  if (/^Which of the following is NOT stated/.test(qt)) return 'mcq_nottrue';
  if (/^Which of the following events happened/.test(qt)) return 'mcq_timeline';
  if (/^Which word best fits/.test(qt)) return 'mcq_vocab';
  return 'mcq_wh'; // wh-questions, passive-by, appositive, known-for, etc.
}

function interleavedPick(pool, count) {
  if (pool.length <= count) return pool;
  const byType = {};
  for (const q of pool) { // preserve arrival order — don't shuffle before bucketing
    const key = getQuestionSubtype(q);
    (byType[key] = byType[key] || []).push(q);
  }
  // Within each bucket: shuffle for variety
  for (const t of Object.keys(byType)) byType[t] = shuffle(byType[t]);
  const types = shuffle(Object.keys(byType));
  const out = [];
  let round = 0;
  while (out.length < count) {
    let anyLeft = false;
    for (const t of types) {
      if (out.length >= count) break;
      if (round < byType[t].length) { out.push(byType[t][round]); anyLeft = true; }
    }
    if (!anyLeft) break;
    round++;
  }
  return out;
}

// ── Shuffle ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── KWIC — Keyword-in-Context blank ──────────────────────────────────────────
function makeKwicBlank(sentence, term) {
  let idx = sentence.indexOf(term);
  if (idx === -1) idx = sentence.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return null;
  const BEFORE_WINDOW = 45;
  const rawBefore = sentence.slice(Math.max(0, idx - BEFORE_WINDOW), idx);
  const before = idx > BEFORE_WINDOW ? rawBefore.replace(/^\S+\s*/, "") : rawBefore;
  const prefix = idx > BEFORE_WINDOW ? "..." : "";
  // Show full sentence after the blank — no truncation
  const after = sentence.slice(idx + term.length).replace(/[.!?]+$/, "");
  return `${prefix}${before}___________${after}`;
}

// ── Question builders ─────────────────────────────────────────────────────────

function makeFill(sentences, count, tfidfScores, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const sStripped = stripEmbeddedClauses(s);
    const wh = toWhQuestion(s) || (sStripped !== s ? toWhQuestion(sStripped) : null);
    if (wh && questionOk(wh.question)) {
      const isProper = /^[A-Z]/.test(wh.answer);
      // Strip leading article for common-noun answers so "the carbon cycle" → "carbon cycle"
      // doesn't fail the word-count limit while "The Great Wall" keeps its article (it's a proper name)
      const answer = isProper ? wh.answer : wh.answer.replace(/^(the|a|an)\s+/i, "").trim();
      const wc = answer.split(" ").length;
      // Proper nouns: up to 5 words; common nouns: up to 3 words (relaxed from 2)
      if (wc <= (isProper ? 5 : 3)) {
        if (computeLeakageScore(wh.question, answer) > 0.5) continue;
        usedSentences.add(s);
        out.push({ type: "fill", question: wh.question, answer, difficulty: "medium", explanation: `From source: "${s}"` });
        continue;
      }
      // Answer too long — fall through to KWIC
    }
    // Skip sentences with embedded quotes for KWIC — they're from reviews/opinions, not facts
    if (/"[^"]{5,}"/.test(s)) continue;
    const term = extractKeyTerm(s, tfidfScores);
    if (!term) continue;
    const kwic = makeKwicBlank(s, term);
    if (!kwic) continue;
    const q = `Fill in the blank: "${kwic}"`;
    if (!questionOk(q)) continue;
    if (computeLeakageScore(q, term) > 0.5) continue;
    usedSentences.add(s);
    out.push({ type: "fill", question: q, answer: term, difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

async function negateWithDatamuse(sentence) {
  const wordRe = /\b([a-z]{4,})\b/gi;
  let m;
  const candidates = [];
  while ((m = wordRe.exec(sentence)) !== null) {
    const w = m[1].toLowerCase();
    if (STOP.has(w)) continue;
    const pos = inferPos(w, sentence.slice(0, m.index));
    if (pos === "adj" || pos === "adv") candidates.push({ word: w, index: m.index, raw: m[1] });
  }
  for (const { word, index, raw } of shuffle(candidates).slice(0, 3)) {
    try {
      const data = await fetchDatamuseCached(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=3`);
      if (!data.length) continue;
      const ant = data.map(d => d.word).find(w => w && !w.includes(" "));
      if (!ant) continue;
      const replacement = raw[0] === raw[0].toUpperCase() ? ant.charAt(0).toUpperCase() + ant.slice(1) : ant;
      return sentence.slice(0, index) + replacement + sentence.slice(index + raw.length);
    } catch {}
  }
  return null;
}

async function makeTF(sentences, count, allEntities, usedSentences) {
  const NEGATION = /\b(not|never|no one|nobody|nothing|nowhere|neither|nor|without|lack|absence)\b/i;
  const BARE_PRONOUN_SUBJECT = /^(He|She|It|They)\b/;
  const MID_CLAUSE_PRONOUN = /,\s+(it|he|she|they|them)\s+\b(was|is|were|are|had|has|did|could|would)\b/i;

  const trueTarget = Math.ceil(count / 2);
  const falseTarget = count - trueTarget;

  // Pass 1: True candidates — use ranked order (TextRank/neural quality) so definitions,
  // proper-noun-rich, causal sentences are preferred over arbitrary ones.
  const trueCandidates = [];
  for (const s of sentences) {
    if (usedSentences.has(s)) continue;
    const q = s.replace(/[.!?]+$/, "");
    if (!questionOk(q)) continue;
    if ((s.match(/"/g) || []).length >= 4) continue;
    if (!NEGATION.test(s) && !BARE_PRONOUN_SUBJECT.test(s) && !MID_CLAUSE_PRONOUN.test(s)) {
      trueCandidates.push({ s, q });
    }
  }
  const trueQs = trueCandidates.slice(0, trueTarget);
  const usedForTrue = new Set(trueQs.map(x => x.s));

  // Pass 2: Batch all adj/adv words across candidate sentences, fetch antonyms in parallel,
  // then build negations without any serial awaits.
  // False candidates: shuffle for variety so repeated calls negate different sentences.
  const falseCandidateSentences = shuffle([...sentences]).filter(s => !usedSentences.has(s) && !usedForTrue.has(s));
  const allAdjAdvWords = new Set();
  const sentenceWordMap = new Map();
  for (const s of falseCandidateSentences) {
    const wordRe = /\b([a-z]{4,})\b/gi;
    let m;
    const candidates = [];
    while ((m = wordRe.exec(s)) !== null) {
      const w = m[1].toLowerCase();
      if (STOP.has(w)) continue;
      const pos = inferPos(w, s.slice(0, m.index));
      if (pos === "adj" || pos === "adv") { candidates.push({ word: w, index: m.index, raw: m[1] }); allAdjAdvWords.add(w); }
    }
    if (candidates.length) sentenceWordMap.set(s, candidates);
  }
  const antonymMap = new Map();
  await Promise.all([...allAdjAdvWords].map(async word => {
    const data = await fetchDatamuseCached(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=3`);
    const ant = data.map(d => d.word).find(w => w && !w.includes(" "));
    antonymMap.set(word, ant || null);
  }));

  const negCandidates = [];
  for (const s of falseCandidateSentences) {
    const wordCandidates = sentenceWordMap.get(s);
    let negResult = null;
    if (wordCandidates) {
      for (const { word, index, raw } of shuffle(wordCandidates).slice(0, 3)) {
        const ant = antonymMap.get(word);
        if (!ant) continue;
        const replacement = raw[0] === raw[0].toUpperCase() ? ant.charAt(0).toUpperCase() + ant.slice(1) : ant;
        negResult = s.slice(0, index) + replacement + s.slice(index + raw.length);
        break;
      }
    }
    const entN = !negResult ? negateSentence(s, allEntities) : null;
    const neg = negResult || entN;
    if (!neg || !questionOk(neg)) continue;
    const hasSwappableEntity = extractProperNouns(s).some(e => allEntities.some(a => a !== e));
    const hasOrdinal = /\b(first|second|third|primary|main|major|central|leading)\b/i.test(s);
    const hasYear = /\b\d{4}\b/.test(s);
    const negStrategy = negResult ? "datamuse" : hasSwappableEntity ? "entity" : hasOrdinal ? "ordinal" : hasYear ? "year" : "verb";
    const quality = negStrategy === "datamuse" ? 4 : negStrategy === "entity" || negStrategy === "ordinal" ? 3 : negStrategy === "year" ? 2 : 1;
    negCandidates.push({ s, q: neg.replace(/[.!?]+$/, ""), quality });
  }
  negCandidates.sort((a, b) => b.quality - a.quality);
  const falseQs = negCandidates.slice(0, falseTarget);

  [...trueQs, ...falseQs].forEach(x => usedSentences.add(x.s));
  const trueOut = trueQs.map(({ q }) => ({ type: "tf", question: q, answer: "True", difficulty: "easy", explanation: "This statement appears directly in the source." }));
  const falseOut = falseQs.map(({ q, s }) => ({ type: "tf", question: q, answer: "False", difficulty: "medium", explanation: `Correct: "${s}"` }));
  return shuffle([...trueOut, ...falseOut]);
}

async function makeMCQ(sentences, count, tfidfScores, allTerms, usedSentences, posPool = null) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    // Dialogue-heavy sentences ("said:", quoted exchanges) test literal reading, not comprehension
    if ((s.match(/"/g) || []).length >= 4) continue;
    const sTerms = extractProperNouns(s);

    const def = extractDefinition(s);
    if (def) {
      const defQ = `What is described as "${def.definition}"?`;
      if (computeLeakageScore(defQ, def.subject) > 0.5) { /* skip */ }
      else {
        const defDistractors = allTerms.filter(t => t !== def.subject && t.split(" ").length <= 3);
        if (questionOk(defQ) && defDistractors.length >= 3) {
          const choices = shuffle([def.subject, ...shuffle(defDistractors).slice(0, 3)]);
          usedSentences.add(s);
          out.push({ type: "mcq", question: defQ, choices, answer: choices.indexOf(def.subject), difficulty: "medium", explanation: `From source: "${s}"` });
          continue;
        }
      }
    }

    const sStripped = stripEmbeddedClauses(s);
    const wh = toWhQuestion(s) || (sStripped !== s ? toWhQuestion(sStripped) : null);
    if (wh && questionOk(wh.question)) {
      if (computeLeakageScore(wh.question, wh.answer) > 0.5) continue;
      const posHint = inferPos(wh.answer.toLowerCase(), s) === "adj" ? "ADJ" : "NOUN";
      let distractors = getDistractors(wh.answer, allTerms, wh.type, sTerms, posPool, tfidfScores, sentences, s);
      if (distractors.length < 3 && !/^[A-Z]/.test(wh.answer) && !/^\d/.test(wh.answer)) {
        distractors = await fetchDatamuseDistractors(wh.answer.toLowerCase(), allTerms.filter(t => !/^[A-Z]/.test(t)), posHint);
      }
      distractors = normalizeLengthDistribution(wh.answer, distractors);
      if (distractors.length < 3) continue;
      const choices = shuffle([wh.answer, ...distractors.slice(0, 3)]);
      usedSentences.add(s);
      out.push({ type: "mcq", question: wh.question, choices, answer: choices.indexOf(wh.answer), difficulty: "medium", explanation: `From source: "${s}"` });
      continue;
    }

    if (/"[^"]{5,}"/.test(s)) continue;
    const answer = extractKeyTerm(s, tfidfScores);
    if (!answer) continue;
    const kwic = makeKwicBlank(s, answer);
    if (!kwic) continue;
    const kwicQ = `Choose the correct answer: "${kwic}"`;
    if (!questionOk(kwicQ)) continue;
    if (computeLeakageScore(kwicQ, answer) > 0.5) continue;
    const type = detectEntityType(answer);
    const posHint = inferPos(answer.toLowerCase(), s) === "adj" ? "ADJ" : "NOUN";
    let distractors = getDistractors(answer, allTerms, type, sTerms, posPool, tfidfScores, sentences, s);
    if (distractors.length < 3 && !/^[A-Z]/.test(answer) && !/^\d/.test(answer)) {
      distractors = await fetchDatamuseDistractors(answer.toLowerCase(), allTerms.filter(t => !/^[A-Z]/.test(t)), posHint);
    }
    distractors = normalizeLengthDistribution(answer, distractors);
    if (distractors.length < 3) continue;
    const choices = shuffle([answer, ...distractors.slice(0, 3)]);
    usedSentences.add(s);
    out.push({ type: "mcq", question: kwicQ, choices, answer: choices.indexOf(answer), difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Cause & Effect questions ──────────────────────────────────────────────────
function makeCauseEffect(sentences, count, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const ce = extractCauseEffect(s);
    if (!ce || !questionOk(ce.question) || ce.answer.length < 5 || ce.answer.split(' ').length > 6) continue;
    usedSentences.add(s);
    out.push({ type: "fill", question: ce.question, answer: trimAnswer(ce.answer), difficulty: "hard", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Sequence questions ────────────────────────────────────────────────────────
function makeSequence(sentences, count, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const seq = extractSequence(s);
    if (!seq || !questionOk(seq.question) || seq.answer.length < 5 || seq.answer.split(' ').length > 6) continue;
    usedSentences.add(s);
    out.push({ type: "fill", question: seq.question, answer: trimAnswer(seq.answer), difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Comparison questions ──────────────────────────────────────────────────────
function makeComparison(sentences, count, allTerms, usedSentences, posPool = null, tfidfScores = {}) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const cmp = extractComparison(s);
    if (!cmp) continue;
    const sTerms = extractProperNouns(s);
    let distractors = getDistractors(cmp.answer, allTerms, "noun", sTerms, posPool, tfidfScores, sentences, s);
    distractors = normalizeLengthDistribution(cmp.answer, distractors);
    if (distractors.length < 3) continue;
    const choices = shuffle([cmp.answer, ...distractors.slice(0, 3)]);
    usedSentences.add(s);
    out.push({ type: "mcq", question: cmp.question, choices, answer: choices.indexOf(cmp.answer), difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── POS heuristic — infer likely part-of-speech from context and word shape ───
function inferPos(word, contextBefore) {
  const w = word.toLowerCase();
  if (/(?:ing)$/.test(w) && !/(?:king|ring|sing|wing|thing|spring|string|swing|bring|cling|fling|sling|sting|wring)$/.test(w)) return "verb";
  if (/(?:ed)$/.test(w) && w.length > 4) return "verb";
  if (/(?:tion|sion|ness|ment|ity|ism|ist|ance|ence|ship|hood|age|ure|ery|ory|ary)$/.test(w)) return "noun";
  if (/(?:ful|less|ous|ious|ive|al|ic|ible|able|ent|ant)$/.test(w)) return "adj";
  if (/(?:ly)$/.test(w) && w.length > 4) return "adv";
  // Context clues
  if (/\b(?:the|a|an|this|that|his|her|its|our|their|my|your|every|each|any|some|no)\s+$/i.test(contextBefore)) return "noun";
  if (/\b(?:to|can|could|will|would|should|may|might|must|shall|did|does|do)\s+$/i.test(contextBefore)) return "verb";
  return "noun"; // default guess
}

// Shared helper: count content words across sentences, excluding stop-words, proper nouns, adverbs.
function buildContentWordFreq(sentences, allTerms) {
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));
  const wordFreq = {};
  sentences.forEach(s => {
    (s.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      .filter(w => !STOP.has(w) && !properLower.has(w) && !GENERIC_BLANK_WORDS.has(w) && inferPos(w, "") !== "adv")
      .forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
  });
  return wordFreq;
}

// ── Double-blank questions ────────────────────────────────────────────────────
function makeDoubleFill(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  const wordFreq = buildContentWordFreq(sentences, allTerms);
  const fullTerms = Object.keys(wordFreq)
    .map(w => ({ w, score: tfidfScores[stem(w)] || 0 }))
    .sort((a, b) => b.score - a.score)
    .map(({ w }) => w);

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    // Overlong sentences produce unreadable double-fill questions
    if (s.length > 200) continue;
    const sLower = s.toLowerCase();

    // Find 2 high-scoring whole-word terms in this sentence
    const found = [];
    for (const term of fullTerms) {
      if (found.length >= 2) break;
      const idx = sLower.indexOf(term);
      if (idx === -1) continue;
      const bc = idx > 0 ? sLower[idx - 1] : " ";
      const ac = idx + term.length < sLower.length ? sLower[idx + term.length] : " ";
      if (/[a-z]/.test(bc) || /[a-z]/.test(ac)) continue;
      if (found.some(f => f.term === term)) continue;
      found.push({ term, idx });
    }
    if (found.length < 2) continue;

    // Sort by position so blank order matches sentence order
    found.sort((a, b) => a.idx - b.idx);

    // Replace terms right-to-left so earlier indices stay valid
    let question = s;
    for (let i = found.length - 1; i >= 0; i--) {
      const { idx, term } = found[i];
      question = question.substring(0, idx) + "___" + question.substring(idx + term.length);
    }

    const answers = found.map(f => f.term); // lowercase for consistent comparison
    // 4 distractors → 6 total choices (2 correct + 4 wrong).
    // Prefer mid-TF-IDF terms (same semantic tier as the answers) over arbitrary top-ranked
    // global terms, which are often obviously about a different sub-topic.
    const answerAvgScore = answers.reduce((acc, a) => acc + (tfidfScores[stem(a)] || 0), 0) / answers.length;
    const midFieldTerms = fullTerms.filter(t => {
      if (answers.includes(t) || t.length <= 3) return false;
      const score = tfidfScores[stem(t)] || 0;
      return score > answerAvgScore * 0.5 && score < answerAvgScore * 2;
    });
    const distractors = shuffle(midFieldTerms.length >= 4 ? midFieldTerms : fullTerms.filter(t => !answers.includes(t) && t.length > 3)).slice(0, 4);
    if (distractors.length < 4) continue;

    // Capitalize first letter for display; original sentence case preserved via comparison being case-insensitive
    const capitalize = w => w.charAt(0).toUpperCase() + w.slice(1);
    const choices = shuffle([...answers, ...distractors].map(capitalize));

    usedSentences.add(s);
    out.push({ type: "double_fill", question, answers, choices, difficulty: "hard", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Datamuse: antonyms + triggers + synonyms + ml, WordNet, similarity filter ─
async function fetchDatamuseDistractors(word, textPool, posHint = null) {
  const lenMin = Math.max(3, Math.round(word.length * 0.6));
  const lenMax = Math.round(word.length * 1.6);
  // Start WordNet early so it runs in parallel with the Datamuse batch below.
  const wnFetch = fetchWordNetDistractors(word, posHint);
  let apiWords = [];
  try {
    const fetches = [
      fetchDatamuseCached(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=8`, 3000),
      fetchDatamuseCached(`/api/lookup?service=datamuse&rel_trg=${encodeURIComponent(word)}&max=12`, 3000),
      fetchDatamuseCached(`/api/lookup?service=datamuse&rel_syn=${encodeURIComponent(word)}&max=8`, 3000),
      fetchDatamuseCached(`/api/lookup?service=datamuse&ml=${encodeURIComponent(word)}&max=12`, 3000),
    ];
    if (posHint === "ADJ") {
      fetches.push(fetchDatamuseCached(`/api/lookup?service=datamuse&rel_jja=${encodeURIComponent(word)}&max=8`, 3000));
    } else if (posHint === "NOUN") {
      fetches.push(fetchDatamuseCached(`/api/lookup?service=datamuse&rel_jjb=${encodeURIComponent(word)}&max=8`, 3000));
    }
    const results = await Promise.all(fetches);
    apiWords = results.flat()
      .map(d => (d.word || "").toLowerCase())
      .filter(w => w && w !== word && !w.includes(" ") && w.length >= lenMin && w.length <= lenMax && !DISTRACTOR_BLOCKLIST.has(w));
  } catch {}

  // wnFetch was started before the try block so it overlaps with Datamuse
  const wnWords = await wnFetch;
  const textWords = textPool.filter(t => t !== word && t.length >= lenMin && t.length <= lenMax);
  const combined = [...new Set([...apiWords, ...wnWords, ...textWords])];

  const filtered = await filterDistractorsBySimilarity(word, combined);
  if (filtered.length >= 3) return shuffle(filtered);

  return shuffle(textPool.filter(t => t !== word));
}

// ── Vocabulary-in-context questions ──────────────────────────────────────────
async function makeVocabContext(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  // Score full words using their TF-IDF score (or their stem's score as fallback)
  const wordFreq = buildContentWordFreq(sentences, allTerms);
  const fullVocabTerms = Object.keys(wordFreq)
    .map(w => ({ w, score: tfidfScores[stem(w)] || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ w }) => w);

  if (fullVocabTerms.length < 4) return out;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const sLower = s.toLowerCase();

    // Find a vocab term that appears as a WHOLE WORD (not a substring of a longer word)
    let matched = null;
    let startIdx = -1;
    for (const term of fullVocabTerms) {
      const idx = sLower.indexOf(term);
      if (idx === -1) continue;
      const beforeChar = idx > 0 ? sLower[idx - 1] : " ";
      const afterChar = idx + term.length < sLower.length ? sLower[idx + term.length] : " ";
      if (/[a-z]/.test(beforeChar) || /[a-z]/.test(afterChar)) continue;
      matched = term;
      startIdx = idx;
      break;
    }
    if (!matched) continue;

    const original = s.substring(startIdx, startIdx + matched.length);
    const kwic = makeKwicBlank(s, original);
    if (!kwic) continue;

    // Detect POS so Datamuse and WordNet use the right relation type
    let vocabPosHint = null;
    wink.readDoc(matched).tokens().each(t => {
      if (vocabPosHint) return;
      const p = t.out(its.pos);
      if (p === 'ADJ' || p === 'NOUN' || p === 'VERB') vocabPosHint = p;
    });
    const rawDistractors = await fetchDatamuseDistractors(matched, fullVocabTerms, vocabPosHint);
    const distractors = normalizeLengthDistribution(matched, rawDistractors).slice(0, 3);
    if (distractors.length < 3) continue;

    const answerDisplay = original.charAt(0).toUpperCase() + original.slice(1);
    const choiceList = [answerDisplay, ...distractors.map(d => d.charAt(0).toUpperCase() + d.slice(1))];
    const choices = shuffle(choiceList);
    usedSentences.add(s);
    out.push({ type: "mcq", question: `Which word best fits: "${kwic}"?`, choices, answer: choices.indexOf(answerDisplay), difficulty: "hard", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Main Idea question ────────────────────────────────────────────────────────
function makeMainIdea(sentences, usedSentences, embeddings = null, centroid = null) {
  const available = sentences.filter(s => !usedSentences.has(s));
  if (available.length < 4) return [];
  let mainIdea = available[0]; // fallback: first in TextRank/neural order
  if (embeddings && centroid) {
    // When embeddings are available, pick the available sentence whose embedding
    // is closest to the document centroid — more reliable than position-based ranking
    // when TextRank inflates repeated named-entity sentences.
    const best = available
      .map(s => { const idx = sentences.indexOf(s); return { s, sim: idx < embeddings.length ? cosineSimilarity(embeddings[idx], centroid) : 0 }; })
      .sort((a, b) => b.sim - a.sim)[0];
    if (best) mainIdea = best.s;
  }
  const remaining = available.filter(s => s !== mainIdea);
  // Pull distractors from the lower half of ranked sentences — top-ranked ones look too similar
  // to the main idea and make the question ambiguous rather than discriminating.
  const distractors = remaining.length >= 6
    ? shuffle(remaining.slice(Math.floor(remaining.length * 0.4))).slice(0, 3)
    : remaining.slice(0, 3);
  // Truncate to display length BEFORE shuffling so indexOf finds the exact string.
  const truncate = s => s.length > 120 ? s.slice(0, 117) + "..." : s;
  const mainIdeaShort = truncate(mainIdea);
  const choices = shuffle([mainIdeaShort, ...distractors.map(truncate)]);
  const answerIdx = choices.indexOf(mainIdeaShort);
  usedSentences.add(mainIdea);
  return [{ type: "mcq", question: "Which sentence best states the main idea of the passage?", choices, answer: answerIdx, difficulty: "medium", explanation: `Main idea: "${mainIdea}"` }];
}

// ── Ordering questions ────────────────────────────────────────────────────────
function makeOrdering(orderedSentences, count, usedSentences) {
  const out = [];
  const SEQ = /\b(first|second|then|next|after|before|finally|initially|later|meanwhile|subsequently|afterward)\b/i;
  // Try 4-sentence windows first (richer ordering task); fall back to 3.
  for (const windowSize of [4, 3]) {
    if (out.length >= count) break;
    for (let i = 0; i <= orderedSentences.length - windowSize && out.length < count; i++) {
      const group = orderedSentences.slice(i, i + windowSize);
      if (group.some(s => usedSentences.has(s))) continue;
      // Accept a group if it has an explicit sequence word OR if every sentence
      // carries a year and the years are strictly non-decreasing (chronological
      // passages that use years rather than "then/after" as the sequencing signal).
      const groupYears = group.map(s => { const m = s.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/); return m ? parseInt(m[1]) : null; });
      const hasMonotonicYears = groupYears.every(y => y !== null) && groupYears.every((y, k) => k === 0 || y >= groupYears[k - 1]);
      if (!group.some(s => SEQ.test(s)) && !hasMonotonicYears) continue;
      const minOk = windowSize === 4 ? 3 : 2;
      if (group.filter(s => questionOk(s)).length < minOk) continue;
      const correct = [...group];
      let scrambled = shuffle([...group]);
      let tries = 0;
      const isIdentical = arr => arr.every((s, j) => s === correct[j]);
      const isReverse = arr => arr.every((s, j) => s === correct[correct.length - 1 - j]);
      const tooSimilar = arr => arr.filter((s, j) => s !== correct[j]).length < 2;
      while ((isIdentical(scrambled) || isReverse(scrambled) || tooSimilar(scrambled)) && tries++ < 20) {
        scrambled = shuffle([...group]);
      }
      group.forEach(s => usedSentences.add(s));
      const expParts = correct.map((s, j) => `${j + 1}. "${s.slice(0, 50)}..."`).join(" ");
      out.push({ type: "ordering", question: "Arrange these sentences in the correct order:", items: scrambled, answers: correct, difficulty: "hard", explanation: `Correct order: ${expParts}` });
    }
  }
  return out;
}

// ── Error Identification questions ────────────────────────────────────────────
async function makeErrorId(sentences, count, usedSentences, allTerms = []) {
  const out = [];
  // Batch all adj/adv words across sentences, fetch antonyms in parallel
  const allWordsNeeded = new Set();
  const sentenceCandidateMap = new Map();
  for (const s of sentences) {
    if (usedSentences.has(s)) continue;
    const wordRe = /\b([a-z]{4,})\b/gi;
    let m;
    const candidates = [];
    while ((m = wordRe.exec(s)) !== null) {
      const w = m[1].toLowerCase();
      if (STOP.has(w)) continue;
      const pos = inferPos(w, s.slice(0, m.index));
      if (pos === "adj" || pos === "adv") { candidates.push({ word: w, index: m.index, raw: m[1] }); allWordsNeeded.add(w); }
    }
    if (candidates.length) sentenceCandidateMap.set(s, candidates);
  }
  const antonymMap = new Map();
  await Promise.all([...allWordsNeeded].map(async word => {
    const data = await fetchDatamuseCached(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=3`);
    const ant = data.map(d => d.word).find(w => w && !w.includes(" "));
    antonymMap.set(word, ant || null);
  }));

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const candidates = sentenceCandidateMap.get(s);
    if (!candidates) continue;
    let swapped = null, errorWord = null, errorOriginal = null;
    for (const { word, index, raw } of shuffle(candidates).slice(0, 4)) {
      const ant = antonymMap.get(word);
      if (!ant) continue;
      const replacement = raw[0] === raw[0].toUpperCase() ? ant.charAt(0).toUpperCase() + ant.slice(1) : ant;
      swapped = s.slice(0, index) + replacement + s.slice(index + raw.length);
      errorWord = replacement; errorOriginal = raw;
      break;
    }
    if (!swapped || !errorWord) {
      // Fallback: swap a single-word proper noun with a wrong entity from allTerms.
      // Keeps the same decoy-extraction logic — all spans come from the sentence text.
      const singleEntities = extractProperNouns(s).filter(e => !e.includes(' ') && e.length > 3);
      for (const entity of shuffle(singleEntities)) {
        const wrong = shuffle(
          allTerms.filter(a => !a.includes(' ') && a.length > 3 && a !== entity && !s.includes(a))
        )[0];
        if (!wrong) continue;
        const safe = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replaced = s.replace(new RegExp(`\\b${safe}\\b`), wrong);
        if (replaced !== s) { swapped = replaced; errorWord = wrong; errorOriginal = entity; break; }
      }
      if (!swapped || !errorWord) continue;
    }
    const origStem = stem(errorOriginal.toLowerCase());
    const decoys = [];
    const decoyRe = /\b([A-Za-z]{4,})\b/g;
    let m;
    while ((m = decoyRe.exec(s)) !== null) {
      const w = m[1], wLow = w.toLowerCase();
      if (wLow === errorOriginal.toLowerCase() || stem(wLow) === origStem || STOP.has(wLow)) continue;
      decoys.push(w);
    }
    if (decoys.length < 3) continue;
    const spans = shuffle([errorWord, ...shuffle(decoys).slice(0, 3)]);
    const answer = spans.findIndex(sp => sp.toLowerCase() === errorWord.toLowerCase());
    usedSentences.add(s);
    out.push({ type: "error_id", question: swapped.replace(/[.!?]+$/, ""), spans, answer, difficulty: "hard", explanation: `"${errorWord}" should be "${errorOriginal}". Original: "${s}"` });
  }
  return out;
}

// ── Translation (Python backend on Render) ────────────────────────────────────
export async function translateQuestions(questions, lang) {
  if (!lang || lang === "English") return questions;
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl) return questions;

  const strings = [];
  const paths = [];

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    strings.push(q.question || ""); paths.push([qi, "question"]);
    strings.push(q.explanation || ""); paths.push([qi, "explanation"]);
    if (Array.isArray(q.choices)) q.choices.forEach((c, j) => { strings.push(c); paths.push([qi, "choices", j]); });
    // fill answer is a word — translate it; tf answer ("True"/"False") is structural — skip
    if (q.type === "fill" && typeof q.answer === "string") { strings.push(q.answer); paths.push([qi, "answer"]); }
    if (Array.isArray(q.answers)) q.answers.forEach((a, j) => { strings.push(a); paths.push([qi, "answers", j]); });
    if (Array.isArray(q.items)) q.items.forEach((item, j) => { strings.push(item); paths.push([qi, "items", j]); });
    if (Array.isArray(q.spans)) q.spans.forEach((sp, j) => { strings.push(sp); paths.push([qi, "spans", j]); });
  }

  // Send in chunks of 20 strings per request
  const CHUNK = 20;
  const translated = [];
  for (let i = 0; i < strings.length; i += CHUNK) {
    const batch = strings.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${backendUrl}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: batch, target: lang }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      const data = res.ok ? await res.json() : null;
      const chunk = data?.translations;
      translated.push(...(Array.isArray(chunk) && chunk.length === batch.length ? chunk : batch));
    } catch { translated.push(...batch); }
  }

  // Deep-copy questions and apply translations
  const result = questions.map(q => ({
    ...q,
    choices: q.choices ? [...q.choices] : q.choices,
    answers: q.answers ? [...q.answers] : q.answers,
    items: q.items ? [...q.items] : q.items,
    spans: q.spans ? [...q.spans] : q.spans,
  }));
  for (let k = 0; k < paths.length; k++) {
    const [qi, field, j] = paths[k];
    if (!translated[k]) continue;
    if (j !== undefined) result[qi][field][j] = translated[k];
    else result[qi][field] = translated[k];
  }
  return result;
}

// ── Number / quantity questions ───────────────────────────────────────────────
function makeQuantityQuestion(sentences, count, usedSentences) {
  const out = [];
  const PERCENT   = /\b(\d+(?:\.\d+)?)\s*(percent|%)\b/i;
  const FRACTION  = /\b(\d+)\s+out\s+of\s+(\d+)\b/i;
  const LARGE_NUM = /\b(\d+(?:\.\d+)?)\s*(million|billion|thousand)\b/i;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;

    // Percentage
    const pctM = s.match(PERCENT);
    if (pctM) {
      const n = parseFloat(pctM[1]);
      // Preserve the original separator (space or none) so all choices match the source format:
      // "45 percent" → fmtUnit = " percent"; "45%" → fmtUnit = "%"
      const fmtUnit = pctM[0].slice(pctM[1].length); // everything after the digits
      const delta = Math.max(5, Math.round(n * 0.3));
      const q = s.replace(pctM[0], `____${fmtUnit.trim()}`).replace(/[.!?]+$/, "");
      if (!questionOk(q)) continue;
      const choices = shuffle([
        pctM[0],
        `${Math.round(Math.max(0, n - delta))}${fmtUnit}`,
        `${Math.min(100, Math.round(n + delta))}${fmtUnit}`,
        `${Math.round(n * 2 > 100 ? n / 2 : n * 2)}${fmtUnit}`,
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4));
      if (choices.length < 3) continue;
      usedSentences.add(s);
      out.push({ type: "mcq", question: q + "?", choices, answer: choices.indexOf(pctM[0]), difficulty: "medium", explanation: `From source: "${s}"` });
      continue;
    }

    // Fraction: "X out of Y"
    const fracM = s.match(FRACTION);
    if (fracM) {
      const x = parseInt(fracM[1]), y = parseInt(fracM[2]);
      if (x >= y) continue;
      const q = s.replace(fracM[0], `____ out of ${y}`).replace(/[.!?]+$/, "");
      if (!questionOk(q)) continue;
      const choices = shuffle([String(x), String(x - 1 || 1), String(x + 1), String(Math.round(y / 2))]
        .filter((v, i, a) => Number(v) > 0 && a.indexOf(v) === i).slice(0, 4));
      if (choices.length < 3) continue;
      usedSentences.add(s);
      out.push({ type: "mcq", question: q + "?", choices, answer: choices.indexOf(String(x)), difficulty: "medium", explanation: `From source: "${s}"` });
      continue;
    }

    // Large number: "N million/billion/thousand"
    const largeM = s.match(LARGE_NUM);
    if (largeM) {
      const n = parseFloat(largeM[1]), unit = largeM[2];
      const q = s.replace(largeM[0], `____ ${unit}`).replace(/[.!?]+$/, "");
      if (!questionOk(q)) continue;
      const choices = shuffle([
        largeM[0],
        `${+(n * 0.5).toFixed(1)} ${unit}`,
        `${Math.round(n * 2)} ${unit}`,
        `${Math.round(n * 1.5)} ${unit}`,
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4));
      if (choices.length < 3) continue;
      usedSentences.add(s);
      out.push({ type: "mcq", question: q + "?", choices, answer: choices.indexOf(largeM[0]), difficulty: "medium", explanation: `From source: "${s}"` });
    }
  }
  return out;
}

// ── Chronological timeline questions ─────────────────────────────────────────
function makeTimeline(sentences, count, usedSentences) {
  const out = [];

  // Collect (year, sentence) pairs — one sentence per year
  const byYear = {};
  for (const s of sentences) {
    if (usedSentences.has(s)) continue;
    const m = s.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
    if (!m) continue;
    // Skip sentences that are figure captions or already-blanked fill sources
    if (/___+/.test(s)) continue;
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+\s+at\s+a\b/i.test(s)) continue; // "Adolf Hitler at a rally..."
    const yr = parseInt(m[1]);
    if (!byYear[yr]) byYear[yr] = s;
  }
  const events = Object.entries(byYear)
    .map(([yr, s]) => ({ year: parseInt(yr), s }))
    .sort((a, b) => a.year - b.year);

  if (events.length < 4) return out;

  const shorten = s => {
    let t = s.replace(/[.!?]+$/, "");
    // Strip leading "In YEAR, " so the year doesn't appear as a giveaway at the start
    t = t.replace(/^In\s+(1[0-9]{3}|20[0-2][0-9]),\s+/i, "");
    // Mask years and relative temporal phrases — both leak ordering information.
    // Handle digit-glued-to-word artifacts ("1939Germany") before the word-boundary replace.
    t = t.replace(/(1[0-9]{3}|20[0-2][0-9])([A-Za-z])/g, '____ $2');
    t = t.replace(/\b(1[0-9]{3}|20[0-2][0-9])\b/g, "____");
    t = t.replace(/\b\d+\s+years?\s+(?:after|before|later|earlier)\b/gi, "some time later");
    t = t.replace(/\b(the\s+following\s+(?:year|decade|century|month))\b/gi, "later");
    t = t.replace(/\b(shortly\s+(?:before|after)|soon\s+after|years?\s+later|a\s+decade\s+later)\b/gi, "later");
    t = t.replace(/\b(by\s+the\s+end\s+of\s+the\s+(?:century|decade|war|period))\b/gi, "eventually");
    return t.length > 78 ? t.slice(0, 75) + "..." : t;
  };

  // Slide a window of 4 across the sorted events
  for (let i = 0; i + 3 < events.length && out.length < count; i++) {
    const group = events.slice(i, i + 4);
    if (group.some(e => usedSentences.has(e.s))) continue;

    const isFirst = out.length % 2 === 0;
    const correct = isFirst ? group[0] : group[group.length - 1];
    const shortened = group.map(e => shorten(e.s));
    const correctShort = shorten(correct.s);
    const choices = shuffle([...shortened]);
    const answer = choices.indexOf(correctShort);
    if (answer === -1) continue;

    group.forEach(e => usedSentences.add(e.s));
    out.push({
      type: "mcq",
      question: isFirst ? "Which of the following events happened FIRST?" : "Which of the following events happened LAST?",
      choices,
      answer,
      difficulty: "hard",
      explanation: `${isFirst ? "Earliest" : "Latest"} event (${correct.year}): "${correct.s}"`,
    });
  }
  return out;
}

// ── Contrast questions ────────────────────────────────────────────────────────
function makeContrast(sentences, count, allTerms, usedSentences) {
  const out = [];
  const CONTRAST_RE = /\b(whereas|while|although|though|however|in\s+contrast|on\s+the\s+other\s+hand|nevertheless|unlike)\b/i;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;

    const connM = s.match(CONTRAST_RE);
    if (!connM) continue;
    const connector = connM[0];
    const connIdx = s.toLowerCase().indexOf(connector.toLowerCase());
    // Skip if connector is at the very start (no left-side idea)
    if (connIdx < 8) continue;

    const left  = s.slice(0, connIdx).trim().replace(/,\s*$/, "");
    const right = s.slice(connIdx + connector.length).trim().replace(/^,?\s*/, "").replace(/[.!?]+$/, "");
    if (left.length < 10 || right.length < 10) continue;

    // Extract subject from each side
    const leftSubj  = left.match(/\b([A-Z][A-Za-z\s]{1,30}?)\s+(?:was|is|were|are|had|has|did|became|could|would)/)?.[1]?.trim();
    const rightSubj = right.match(/^([A-Z][A-Za-z\s]{1,30}?)\s+(?:was|is|were|are|had|has|did|became|could|would)/)?.[1]?.trim();

    // Discard subjects that start with a subordinating conjunction — they're clause
    // fragments ("While scholars", "Although Rome"), not usable question subjects.
    const SUBORD = /^(while|although|though|whereas|since|because|if|when|after|before|as|until|unless)\b/i;
    if (leftSubj && SUBORD.test(leftSubj)) continue;
    if (rightSubj && SUBORD.test(rightSubj)) continue;

    if (rightSubj && /^[A-Z]/.test(rightSubj) && !STOP.has(rightSubj.toLowerCase()) && leftSubj) {
      // Proper-noun contrast → MCQ
      const question = `According to the passage, what is contrasted with "${leftSubj}"?`;
      if (!questionOk(question)) continue;
      const rightType = detectEntityType(rightSubj);
      const typePool = allTerms.filter(t => t !== leftSubj && t !== rightSubj && t.length > 2 && detectEntityType(t) === rightType);
      const rawDistr = typePool.length >= 3
        ? shuffle(typePool).slice(0, 6)
        : shuffle(allTerms.filter(t => t !== leftSubj && t !== rightSubj && t.length > 2)).slice(0, 6);
      const distractors = normalizeLengthDistribution(rightSubj, rawDistr);
      if (distractors.length < 3) continue;
      const choices = shuffle([rightSubj, ...distractors]);
      usedSentences.add(s);
      out.push({ type: "mcq", question, choices, answer: choices.indexOf(rightSubj), difficulty: "medium", explanation: `From source: "${s}"` });
    } else {
      // Common-noun or abstract contrast → fill question
      // Reject long clauses and comma-clauses ("officially neutral, was generally aligned…")
      if (right.split(" ").length > 8) continue;
      if (/,\s*(was|is|were|are|had|has|would|could|did)\b/i.test(right)) continue;
      const shortRight = trimAnswer(right, 60);
      if (shortRight.length < 5 || shortRight.endsWith("…")) continue;
      const question = `"${trimAnswer(left, 70)}…" — what does the passage contrast this with?`;
      if (!questionOk(question)) continue;
      if (computeLeakageScore(question, shortRight) > 0.45) continue;
      usedSentences.add(s);
      out.push({ type: "fill", question, answer: shortRight, difficulty: "medium", explanation: `From source: "${s}"` });
    }
  }
  return out;
}

// ── TextRank sentence ranking ─────────────────────────────────────────────────
// tfidfScores: passed from generateNoAiQuiz so rare shared words pull sentences
// together more strongly than common words like "battle" or "army".
function textRank(sentences, iterations = 30, damping = 0.85, tfidfScores = {}) {
  const n = sentences.length;
  if (n < 3) return sentences;
  const cap = Math.min(n, 60);
  const capped = sentences.slice(0, cap);

  const wordSets = capped.map(s =>
    new Set(s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))
  );

  const sentLens = capped.map(s => s.split(/\s+/).length);
  function sim(i, j) {
    const a = wordSets[i], b = wordSets[j];
    if (!a.size || !b.size) return 0;
    // TF-IDF weighted overlap: rare shared words contribute more than common ones.
    // Fall back to 0.1 so sentences with no scored vocabulary still connect weakly.
    let weighted = 0;
    for (const w of a) {
      if (b.has(w)) weighted += (tfidfScores[stem(w)] || tfidfScores[w] || 0.1);
    }
    return weighted / (Math.log2(sentLens[i] + 1) + Math.log2(sentLens[j] + 1) + 1e-6);
  }

  // Precompute similarity matrix
  const S = Array.from({ length: cap }, (_, i) =>
    Array.from({ length: cap }, (_, j) => (i === j ? 0 : sim(i, j)))
  );
  const outSum = S.map(row => row.reduce((a, b) => a + b, 0));

  let scores = new Array(cap).fill(1 / cap);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Array(cap).fill((1 - damping) / cap);
    for (let j = 0; j < cap; j++) {
      if (!outSum[j]) continue;
      for (let i = 0; i < cap; i++) {
        next[i] += damping * (S[j][i] / outSum[j]) * scores[j];
      }
    }
    scores = next;
  }

  const ranked = capped
    .map((s, i) => ({ s, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
  return [...ranked, ...sentences.slice(cap)];
}

// ── Superlative / extremum questions ──────────────────────────────────────────
function makeSuperlative(sentences, count, usedSentences) {
  const out = [];
  const SUP = /\b(the\s+(?:first|last|only|largest|smallest|biggest|highest|lowest|oldest|newest|youngest|greatest|longest|shortest|deepest|tallest|richest|poorest|fastest|slowest|strongest|weakest|most\s+\w+|least\s+\w+))\b/i;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const supMatch = s.match(SUP);
    if (!supMatch) continue;
    const superlative = supMatch[1].trim();

    // "[X] was/is the [superlative]" → answer = X
    const subjMatch = s.match(/^([A-Z][A-Za-z\s]{1,40}?)\s+(?:is|was|were|are|remains?|became)\s+the\s+/);
    // "the [superlative] [ProperNoun]" → answer = ProperNoun
    const objMatch = s.match(
      /the\s+(?:first|last|only|largest|biggest|greatest|longest|oldest|highest|most\s+\w+|least\s+\w+)\s+([A-Z][A-Za-z\s]{2,35})/
    );

    let answer = null, question = null;
    if (subjMatch) {
      answer = subjMatch[1].trim();
      // Include 1-2 words after the superlative so question reads "What was the largest planet?"
      // rather than the bare "What was the largest?"
      const afterSup = s.slice(subjMatch[0].length);
      const nounM = afterSup.match(/^(\w+(?:\s+\w+)?)/);
      const phrase = nounM ? nounM[1].replace(/^the\s+/i, '') : superlative.replace(/^the\s+/i, '');
      question = `What was the ${phrase}?`;
    } else if (objMatch) {
      answer = objMatch[1].trim().replace(/[.!?,]+$/, "");
      question = `What was the ${superlative.replace(/^the\s+/i, "").trim()}?`;
    }

    if (!answer || !question) continue;
    if (answer.length < 2 || answer.split(" ").length > 5) continue;
    if (STOP.has(answer.toLowerCase()) || !questionOk(question)) continue;

    usedSentences.add(s);
    out.push({ type: "fill", question, answer, difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── List / enumeration questions ──────────────────────────────────────────────
function makeListQuestion(sentences, count, allTerms, usedSentences) {
  const out = [];
  // Match "A, B, and C" or "A, B, and C" patterns with proper-noun items
  const AND_LIST = /([A-Z][A-Za-z\s]{1,30}?),\s+([A-Z][A-Za-z\s]{1,30}?),?\s+and\s+([A-Z][A-Za-z\s]{1,30})/;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const listMatch = s.match(AND_LIST);
    if (!listMatch) continue;

    const items = [
      listMatch[1].trim(),
      listMatch[2].trim(),
      listMatch[3].trim().replace(/[.!?,;]+$/, ""),
    ];
    // Max 3 words — 4-word items like "Italy forced Czechoslovakia to" are sentence fragments
    if (items.some(item => item.length > 35 || item.split(" ").length > 3)) continue;
    if (items.some(item => STOP.has(item.toLowerCase()))) continue;
    // Extended verb list — catches action verbs that make items into clause fragments
    const VERB_IN_ITEM = /\b(conquered|established|reorganized|created|built|founded|wrote|led|defeated|captured|signed|organized|formed|launched|produced|invented|developed|introduced|discovered|forced|required|allowed|made|sent|gave|took|kept|used|held|brought|caused|helped|left|called|named|became)\b/i;
    if (items.some(item => VERB_IN_ITEM.test(item))) continue;
    if (items.some(item => {
      const lastWord = item.split(/\s+/).at(-1).toLowerCase();
      return inferPos(lastWord, "") === "verb";
    })) continue;
    // Reject adverb-phrase or conjunction starts ("Soon afterwards", "Later", "Also", etc.)
    const ADV_START = /^(soon|just|also|then|still|later|earlier|while|when|if|as|at|in|on|by|for|with|however|therefore|thus|before|after|already|once|again|often|never|always)\b/i;
    if (items.some(item => ADV_START.test(item))) continue;
    // Every item must look like a proper noun phrase — starts with capital, not an adjective alone
    if (!items.every(item => /^[A-Z][a-z]/.test(item))) continue;

    const itemTypes = items.map(detectEntityType);
    const majorityType = [...itemTypes].sort((a, b) =>
      itemTypes.filter(t => t === b).length - itemTypes.filter(t => t === a).length
    )[0];
    const typePool = allTerms.filter(t => !items.includes(t) && t.length > 2 && detectEntityType(t) === majorityType);
    const distractor = typePool.length
      ? shuffle(typePool)[0]
      : shuffle(allTerms.filter(t => !items.includes(t) && t.length > 2))[0];
    if (!distractor) continue;

    // Require a clear subject phrase — "the items listed" is too vague to be a useful question
    const categoryMatch = s.match(/^(.{5,55}?)\s+(?:were|was|are|is|included?|consisted of|comprised)/i);
    if (!categoryMatch) continue;
    const category = categoryMatch[1].trim().toLowerCase();

    const choices = shuffle([...items, distractor]);
    usedSentences.add(s);
    out.push({
      type: "mcq",
      question: `Which of the following was NOT part of ${category}?`,
      choices,
      answer: choices.indexOf(distractor),
      difficulty: "hard",
      explanation: `Listed in source: "${items.join(", ")}". "${distractor}" was not mentioned.`,
    });
  }
  return out;
}

const MONTHS_SET = new Set(["january","february","march","april","may","june","july","august","september","october","november","december"]);

// ── Named-entity co-occurrence questions ──────────────────────────────────────
function makeCooccurrence(sentences, count, allTerms, usedSentences) {
  const out = [];

  // Build a set of all proper noun name fragments (lowercase) to exclude from concept pool
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));

  // Count how often each (entity, concept) pair appears in the same sentence
  const coCount = {};
  for (const s of sentences) {
    // Exclude months and single-word entities (months, ambiguous single caps)
    const entities = extractProperNouns(s).filter(e => {
      const low = e.toLowerCase();
      if (MONTHS_SET.has(low)) return false;
      if (STOP.has(low)) return false;
      // Require at least 2 words OR be a clearly non-month multi-char word
      return e.includes(" ") || e.length >= 5;
    });
    // Only use NOUN tokens as concepts — verbs ("released") and adjectives ("official") make nonsensical answers
    const concepts = [];
    wink.readDoc(s).tokens().each(t => {
      if (t.out(its.pos) !== 'NOUN') return;
      const w = t.out(its.value).toLowerCase();
      if (w.length < 5 || STOP.has(w) || GENERIC_BLANK_WORDS.has(w) || MONTHS_SET.has(w) || properLower.has(w)) return;
      concepts.push(w);
    });
    for (const entity of entities) {
      for (const concept of [...new Set(concepts)]) {
        const key = `${entity}|||${concept}`;
        coCount[key] = (coCount[key] || 0) + 1;
      }
    }
  }

  // Sort by co-occurrence count, highest first
  // Scale threshold with document length — in a 500-sentence passage a pair
  // appearing twice is noise; a genuinely associated pair appears 5–10+ times.
  const minCoOcc = Math.max(1, Math.floor(sentences.length / 40));
  const pairs = Object.entries(coCount)
    .filter(([, c]) => c >= minCoOcc)
    .sort((a, b) => b[1] - a[1]);

  // Collect unique top concepts per entity (avoid repeating the same entity)
  const usedEntities = new Set();

  for (const [key] of pairs) {
    if (out.length >= count) break;
    const [entity, concept] = key.split("|||");
    if (usedEntities.has(entity)) continue;

    // Find a source sentence for context
    const sourceSentence = sentences.find(
      s => !usedSentences.has(s) && s.includes(entity) && s.toLowerCase().includes(concept)
    );
    if (!sourceSentence) continue;

    // Distractors: round-robin across different other entities to prevent single-cluster clumping
    const distractorsByEntity = {};
    for (const [k] of pairs) {
      const [e, c] = k.split("|||");
      if (e === entity || c === concept) continue;
      if (!distractorsByEntity[e]) distractorsByEntity[e] = [];
      distractorsByEntity[e].push(c);
    }
    const entityKeys = shuffle(Object.keys(distractorsByEntity));
    const rawDistractors = [];
    let rnd = 0;
    while (rawDistractors.length < 9 && entityKeys.some(e => rnd < (distractorsByEntity[e]?.length || 0))) {
      for (const e of entityKeys) {
        if (rawDistractors.length >= 9) break;
        if (rnd < (distractorsByEntity[e]?.length || 0)) rawDistractors.push(distractorsByEntity[e][rnd]);
      }
      rnd++;
    }
    const distractors = normalizeLengthDistribution(concept, rawDistractors);
    if (distractors.length < 3) continue;

    const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
    const answerDisplay = cap(concept);
    const choices = shuffle([answerDisplay, ...shuffle(distractors).slice(0, 3).map(cap)]);

    usedEntities.add(entity);
    usedSentences.add(sourceSentence);
    out.push({
      type: "mcq",
      question: `Which concept is most associated with ${entity} in this passage?`,
      choices,
      answer: choices.indexOf(answerDisplay),
      difficulty: "medium",
      explanation: `From source: "${sourceSentence}"`,
    });
  }
  return out;
}

// ── Neural sentence scoring (HuggingFace all-MiniLM-L6-v2) ───────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

function computeCentroid(embeddings) {
  const dim = embeddings[0].length;
  const c = new Array(dim).fill(0);
  for (const e of embeddings) for (let i = 0; i < dim; i++) c[i] += e[i] / embeddings.length;
  return c;
}

async function fetchEmbeddings(sentences) {
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentences }),
      signal,
    });
    if (!res.ok) return null;
    const { embeddings } = await res.json();
    return Array.isArray(embeddings) && embeddings.length === sentences.length ? embeddings : null;
  } catch {
    return null;
  }
}

// ── "NOT stated in the passage" questions ────────────────────────────────────
// Generates a false statement via entity/year swap, then uses 3 true sentences
// as distractors. Correct answer = the false one.
function makeNotTrue(sentences, count, allTerms, usedSentences) {
  const out = [];
  const usedAsDistractor = new Set();
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    if (!questionOk(s.replace(/[.!?]+$/, ""))) continue;
    const falseVer = negateSentence(s, allTerms);
    if (!falseVer || falseVer === s) continue;
    const falseText = falseVer.replace(/[.!?]+$/, "").slice(0, 110);
    // Three true sentences as distractors — exclude sentences already used as distractors
    // in a previous makeNotTrue question to prevent detectable repetition.
    const trueSentences = shuffle(sentences.filter(x => x !== s && !usedSentences.has(x) && !usedAsDistractor.has(x))).slice(0, 3);
    if (trueSentences.length < 3) continue;
    const targetLen = Math.min(110, Math.round(falseText.length * 1.2));
    const trues = trueSentences.map(x => {
      const t = x.replace(/[.!?]+$/, "");
      return t.length > targetLen ? t.slice(0, targetLen - 3) + "..." : t;
    });
    trueSentences.forEach(x => usedAsDistractor.add(x));
    const choices = shuffle([falseText, ...trues]);
    const answer = choices.indexOf(falseText);
    if (answer === -1) continue;
    usedSentences.add(s);
    out.push({
      type: "mcq",
      question: "Which of the following is NOT stated in the passage?",
      choices,
      answer,
      difficulty: "hard",
      explanation: `The false statement is a modified version of: "${s}"`,
    });
  }
  return out;
}

// ── ConceptNet semantic questions ─────────────────────────────────────────────
const CN_REL = {
  "/r/IsA":         w => `What type of thing is ${w}?`,
  "/r/UsedFor":     w => `What is ${w} used for?`,
  "/r/HasProperty": w => `What is a property of ${w}?`,
  "/r/CapableOf":   w => `What can ${w} do?`,
  "/r/PartOf":      w => `What is ${w} a part of?`,
  "/r/Causes":      w => `What can ${w} cause?`,
  "/r/MadeOf":      w => `What is ${w} made of?`,
};

async function makeConceptNetQuestion(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];

  // Build stem → longest original word map from sentences so we query ConceptNet with
  // real words ("photosynthesis") instead of Porter stems ("photosynthes").
  const stemToWord = {};
  for (const s of sentences) {
    for (const w of (s.match(/\b[a-z]{4,}\b/gi) || [])) {
      const lw = w.toLowerCase();
      if (STOP.has(lw)) continue;
      const st = stem(lw);
      if (!stemToWord[st] || lw.length > stemToWord[st].length) stemToWord[st] = lw;
    }
  }

  // Pick top TF-IDF stems, map each back to its original word form
  const topTerms = Object.entries(tfidfScores)
    .filter(([w]) => w.length >= 4 && !STOP.has(w) && !GENERIC_BLANK_WORDS.has(w) && !/^[A-Z]{2,}$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => stemToWord[w] || w)
    .filter((w, i, arr) => arr.indexOf(w) === i) // deduplicate after un-stemming
    .slice(0, 5);

  if (!topTerms.length) return out;

  // Fetch all terms in parallel
  const fetchResults = await Promise.all(topTerms.map(async term => {
    try {
      const res = await fetch(`/api/lookup?service=conceptnet&concept=${encodeURIComponent(term)}&limit=20`);
      if (!res.ok) return null;
      const data = await res.json();
      return { term, edges: data.edges || [] };
    } catch { return null; }
  }));

  // Build relation → [end labels] map across all terms for cross-concept distractors
  const relPool = {}; // relId → Set<string>
  for (const result of fetchResults) {
    if (!result) continue;
    for (const edge of result.edges) {
      const relId = edge.rel?.["@id"];
      if (!CN_REL[relId]) continue;
      const startLang = edge.start?.["@id"]?.startsWith("/c/en/") ?? true;
      const endLang = edge.end?.["@id"]?.startsWith("/c/en/") ?? true;
      if (!startLang || !endLang) continue;
      const endLabel = (edge.end?.label || "").toLowerCase().trim();
      if (!endLabel || endLabel.split(" ").length > 4 || STOP.has(endLabel)) continue;
      if (!relPool[relId]) relPool[relId] = new Set();
      relPool[relId].add(endLabel);
    }
  }

  for (const result of shuffle(fetchResults)) {
    if (out.length >= count) break;
    if (!result) continue;
    const { term, edges } = result;

    // Require at least one sentence mentioning this term
    const src = sentences.find(s => !usedSentences.has(s) && s.toLowerCase().includes(term));
    if (!src) continue;

    // Find the best forward edge (term is the start, edge is in CN_REL, weight ≥ 1)
    const candidates = edges
      .filter(e => {
        const relId = e.rel?.["@id"];
        if (!CN_REL[relId]) return false;
        const startLabel = (e.start?.label || "").toLowerCase().replace(/_/g, " ");
        if (startLabel !== term) return false;
        if (!e.start?.["@id"]?.startsWith("/c/en/")) return false;
        if (!e.end?.["@id"]?.startsWith("/c/en/")) return false;
        const endLabel = (e.end?.label || "").toLowerCase();
        if (!endLabel || endLabel === term || STOP.has(endLabel)) return false;
        if (endLabel.split(" ").length > 4) return false;
        return (e.weight || 0) >= 1.0;
      })
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));

    if (!candidates.length) continue;

    // Try up to 3 candidates — the top-ranked edge may have too few cross-concept distractors
    let edge = null, relId, answer, questionText, pool;
    for (const candidate of candidates.slice(0, 3)) {
      const cRelId = candidate.rel["@id"];
      // Exclude all edge targets for THIS term under this relation — not just the chosen answer.
      // Other synsets of the same term could appear as "distractors" that are actually correct.
      const termOwnTargets = new Set(
        edges.filter(e => e.rel?.["@id"] === cRelId).map(e => (e.end?.label || "").toLowerCase())
      );
      const cPool = [...(relPool[cRelId] || [])].filter(w => w !== candidate.end.label.toLowerCase() && !termOwnTargets.has(w));
      if (cPool.length >= 3) {
        const cAnswer = candidate.end.label.toLowerCase();
        // Only use this edge if the answer actually appears in the source text.
        // Pure world-knowledge answers (not mentioned in the passage) have no
        // context clue for students reading this specific document.
        if (!sentences.some(s => s.toLowerCase().includes(cAnswer))) continue;
        edge = candidate; relId = cRelId; pool = cPool;
        answer = cAnswer;
        questionText = CN_REL[relId](term);
        break;
      }
    }
    if (!edge) continue;

    const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
    const distractors = shuffle(pool).slice(0, 3).map(cap);
    const answerCapped = cap(answer);
    const choices = shuffle([answerCapped, ...distractors]);

    usedSentences.add(src);
    out.push({
      type: "mcq",
      question: questionText,
      choices,
      answer: choices.indexOf(answerCapped),
      difficulty: "medium",
      explanation: `Based on ConceptNet: "${term}" — ${edge.rel.label} — "${answer}". Found in: "${src}"`,
    });
  }

  return out;
}

// ── Pronoun Reference questions ───────────────────────────────────────────────
// Compares raw (pre-coref) and resolved sentences. Wherever a pronoun was
// replaced by a name, generate: "Who does 'He' refer to in this passage?"
// Word-diff approach: walk both token arrays in parallel, find what the pronoun
// was replaced with. More reliable than entity-set subtraction which fails when
// the replacement name already appears elsewhere in the raw sentence.
function findPronounReplacement(raw, resolved) {
  const PRON = /^(He|She|They|It|His|Her|Their|Him)$/i;
  const rw = raw.split(/(\s+)/);
  const sw = resolved.split(/(\s+)/);
  let ri = 0, si = 0;
  while (ri < rw.length && si < sw.length) {
    if (rw[ri] === sw[si]) { ri++; si++; continue; }
    if (PRON.test(rw[ri].replace(/[^a-zA-Z]/g, ""))) {
      const start = si;
      ri++;
      // advance si until tokens re-sync (max 4 tokens ahead for multi-word names)
      while (si < sw.length && si - start < 5 && sw[si] !== rw[ri]) si++;
      const replacement = sw.slice(start, si).join("").replace(/[''s,.]+$/, "").trim();
      if (replacement && /^[A-Z]/.test(replacement) && !STOP.has(replacement.toLowerCase()) && replacement.length > 2) return replacement;
    } else { ri++; si++; }
  }
  return null;
}

function makePronounRefQuestions(rawSentences, resolvedSentences, allTerms, count, usedSentences) {
  const out = [];
  const PRON_RE = /\b(He|She|They|It)\b/;
  for (let i = 0; i < rawSentences.length && out.length < count; i++) {
    const raw = rawSentences[i];
    const resolved = resolvedSentences[i];
    if (raw === resolved) continue;
    if (usedSentences.has(raw)) continue;
    const pronounMatch = raw.match(PRON_RE);
    if (!pronounMatch) continue;
    const pronoun = pronounMatch[0];
    // Expletive "It" — "It is/was/has been..." at sentence start is not a real pronoun reference
    if (pronoun === 'It' && /^It\s+(is|was|has been|had been|seems|appears|became|happened|turns? out)/i.test(raw)) continue;
    // Use word-diff to find what replaced the pronoun — more reliable than entity-set
    // subtraction when the referent name already appears elsewhere in the raw sentence.
    const antecedent = findPronounReplacement(raw, resolved);
    if (!antecedent) continue;
    const antecedentType = detectEntityType(antecedent);
    const typeFiltered = allTerms.filter(t => t !== antecedent && /^[A-Z]/.test(t) && t.length > 2 && detectEntityType(t) === antecedentType);
    const distractors = shuffle(typeFiltered.length >= 3 ? typeFiltered : allTerms.filter(t => t !== antecedent && /^[A-Z]/.test(t) && t.length > 2)).slice(0, 3);
    if (distractors.length < 2) continue;
    const display = raw.length > 100 ? raw.slice(0, 100) + "..." : raw;
    // "who" for people; "what" for places, orgs, things, and "It" references
    const questionWord = (pronoun !== 'It' && pronoun !== 'They' && antecedentType === 'person') ? 'who' : 'what';
    const choices = shuffle([antecedent, ...distractors]);
    usedSentences.add(raw);
    out.push({
      type: "mcq",
      question: `In the passage, ${questionWord} does "${pronoun}" refer to in: "${display}"?`,
      choices,
      answer: choices.indexOf(antecedent),
      difficulty: "medium",
      explanation: `"${pronoun}" refers to "${antecedent}" based on the preceding context.`,
    });
  }
  return out;
}

// ── Datamuse pre-warm ─────────────────────────────────────────────────────────
// Batch-fetch antonyms + ml relations for the top vocab and adj/adv words upfront,
// so all per-question Datamuse calls hit the cache instead of firing serially.
async function prewarmDatamuseCache(sentences, tfidfScores, allTerms) {
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));
  const vocabCandidates = [...new Set(
    sentences.flatMap(s =>
      (s.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
        .filter(w => !STOP.has(w) && !properLower.has(w) && !GENERIC_BLANK_WORDS.has(w))
    )
  )];
  const topVocab = vocabCandidates
    .map(w => ({ w, score: tfidfScores[stem(w)] || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20).map(x => x.w);
  const adjAdvWords = [...new Set(
    sentences.flatMap(s => {
      const matches = [];
      const wordRe = /\b([a-z]{4,})\b/gi;
      let m;
      while ((m = wordRe.exec(s)) !== null) {
        const w = m[1].toLowerCase();
        if (!STOP.has(w) && (inferPos(w, "") === "adj" || inferPos(w, "") === "adv")) matches.push(w);
      }
      return matches;
    })
  )].slice(0, 30);
  const allWords = [...new Set([...topVocab, ...adjAdvWords])];
  await Promise.all(allWords.map(w => Promise.all([
    fetchDatamuseCached(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(w)}&max=8`, 3000),
    fetchDatamuseCached(`/api/lookup?service=datamuse&ml=${encodeURIComponent(w)}&max=12`, 3000),
  ])));
}

// ── Dynamic difficulty ────────────────────────────────────────────────────────
// Overrides hardcoded difficulty labels using the answer's TF-IDF score:
//   high score  → central / frequently-discussed term → easier to recall → "easy"
//   medium score → moderately specific term → "medium"
//   low / zero  → obscure or peripheral term → harder to recall → "hard"
// Applied as a single post-processing pass so individual builders don't need tfidfScores.
function applyDynamicDifficulty(questions, tfidfScores) {
  return questions.map(q => {
    // Structural question types get fixed difficulty — don't override
    if (q.type === 'ordering' || q.type === 'error_id') return q;
    const answerStr = q.type === 'double_fill'
      ? (q.answers || [])[0] || ''
      : q.type === 'tf'
        ? null // T/F: true=easy, false=medium — keep existing label
        : (typeof q.answer === 'number' ? q.choices?.[q.answer] : q.answer) || '';
    if (!answerStr) return q;
    const score = tfidfScores[stem(answerStr.toLowerCase())] || tfidfScores[answerStr.toLowerCase()] || 0;
    const difficulty = score > 0.65 ? 'easy' : score > 0.25 ? 'medium' : 'hard';
    return { ...q, difficulty };
  });
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateNoAiQuiz(text, numQ, qType, lang = "English") {
  if (text.length > 50000) text = text.slice(0, 50000);
  const { sorted: sentences, ordered: sentencesOrdered, raw: rawSentences, posPool } = extractSentences(text, { returnBoth: true });
  if (sentences.length < 5) throw new Error("Not enough content to generate questions. Try adding more text.");

  const tfidfScores = tfidf(sentences);

  // Fire YAKE concurrently — it runs during neural re-ranking and adds zero latency
  const yakeFetch = fetchBackendKeywords(text);

  // Build inverted index over all sentences for fast distractor proximity ranking
  _invertedIndex = {};
  for (const s of sentences) {
    const sLow = s.toLowerCase();
    for (const w of sLow.split(/\s+/)) {
      if (w.length > 3 && !STOP.has(w)) {
        if (!_invertedIndex[w]) _invertedIndex[w] = new Set();
        _invertedIndex[w].add(sLow);
      }
    }
  }

  const allTerms = [...new Set(sentences.flatMap(s => extractProperNouns(s)))];
  // Years from the text are better distractors for year-type questions than computed ±deltas
  const allYears = [...new Set(sentences.flatMap(s => [...s.matchAll(/\b(1[3-9]\d{2}|20[0-2]\d)\b/g)].map(m => m[1])))];
  const allTermsWithYears = [...allTerms, ...allYears];
  const usedSentences = new Set();

  // TextRank: run on document-order sentences so the cap-60 window isn't biased by
  // the initial scoreSentence sort, then weight similarity by TF-IDF so rare shared
  // words pull sentences together more strongly than common ones.
  let ranked = textRank(sentencesOrdered, 30, 0.85, tfidfScores);

  // Neural re-ranking + spaCy dep parse run in parallel.
  // Larger batch (80) means the centroid is computed from more of the document,
  // reducing the bias that arose when only the top 40 sentences were embedded.
  const batchSize = Math.min(ranked.length, 80);
  const batch = ranked.slice(0, batchSize);
  const [embeddings, parseResults] = await Promise.all([
    fetchEmbeddings(batch),
    parseWithSpacy(ranked.slice(0, 20)),
  ]);
  if (embeddings) {
    const centroid = computeCentroid(embeddings);
    const neuralScored = batch.map((s, i) => ({ s, score: cosineSimilarity(embeddings[i], centroid) }));
    neuralScored.sort((a, b) => b.score - a.score);
    ranked = [...neuralScored.map(x => x.s), ...ranked.slice(batchSize)];
  }

  // Merge YAKE keyphrases into tfidfScores: boosts terms YAKE found semantically central.
  // Each word in a YAKE keyphrase gets +30% of the YAKE score, capped at 1.0.
  // This runs after neural re-ranking since yakeFetch was in-flight during that await.
  const yakeKeywords = await yakeFetch;
  for (const { word, score } of yakeKeywords) {
    for (const w of word.toLowerCase().split(/\s+/)) {
      if (w.length <= 3 || STOP.has(w)) continue;
      const boost = score * 0.3;
      tfidfScores[w] = Math.min(1, (tfidfScores[w] || 0) + boost);
      const s = stem(w);
      if (s !== w) tfidfScores[s] = Math.min(1, (tfidfScores[s] || 0) + boost);
    }
  }

  // Pre-warm Datamuse cache after neural re-ranking so the top-30 reflects the final order
  await prewarmDatamuseCache(ranked.slice(0, 30), tfidfScores, allTerms);

  let qs;
  if (qType === "fill") {
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTermsWithYears, depUsed, posPool, tfidfScores, ranked);
    [...depUsed].forEach(s => usedSentences.add(s));
    qs = shuffle([...depQs, ...makeFill(ranked, numQ * 2, tfidfScores, usedSentences)]);
  }
  else if (qType === "tf") qs = await makeTF(ranked, numQ * 2, allTermsWithYears, usedSentences);
  else if (qType === "mcq") {
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTermsWithYears, depUsed, posPool, tfidfScores, ranked).filter(q => q.type === 'mcq');
    [...depUsed].forEach(s => usedSentences.add(s));
    qs = shuffle([...depQs, ...await makeMCQ(ranked, numQ * 2, tfidfScores, allTermsWithYears, usedSentences, posPool)]);
  }
  else if (qType === "double_fill") qs = makeDoubleFill(ranked, numQ, tfidfScores, allTerms, usedSentences);
  else if (qType === "ordering") qs = makeOrdering(sentencesOrdered, numQ, usedSentences);
  else if (qType === "error_id") qs = await makeErrorId(ranked, numQ, usedSentences, allTermsWithYears);
  else {
    // Mixed: generate from all types, shuffle, take numQ
    const q = Math.ceil(numQ / 3);
    // Fire FLAN speculatively — runs during the parallel generators below (no added latency).
    // Only awaited later if the rule-based pool turns out to be thin.
    const flanFetch = fetchFlanQuestions(ranked.filter(s => !usedSentences.has(s)).slice(0, 8), tfidfScores);
    // Each parallel function gets its own usedSentences to prevent mid-await races
    const used1 = new Set(), used2 = new Set(), used3 = new Set(), used4 = new Set(), used5 = new Set();
    const [tfQs, vocabQs, mcqQs, errorQs, cnQs] = await Promise.all([
      makeTF(ranked, q, allTermsWithYears, used1),
      makeVocabContext(ranked, q, tfidfScores, allTermsWithYears, used2),
      makeMCQ(ranked, q, tfidfScores, allTermsWithYears, used3, posPool),
      makeErrorId(ranked, Math.ceil(q / 2), used4, allTermsWithYears),
      makeConceptNetQuestion(ranked, Math.ceil(q / 2), tfidfScores, allTermsWithYears, used5),
    ]);
    // Merge into shared set so sequential builders below don't reuse these sentences
    [...used1, ...used2, ...used3, ...used4, ...used5].forEach(s => usedSentences.add(s));
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTermsWithYears, depUsed, posPool, tfidfScores, ranked);
    [...depUsed].forEach(s => usedSentences.add(s));
    const pool = shuffle([
      ...mcqQs,
      ...tfQs,
      ...depQs,
      ...makeFill(ranked, q, tfidfScores, usedSentences),
      ...makeCauseEffect(ranked, q, usedSentences),
      ...makeSequence(ranked, q, usedSentences),
      ...makeComparison(ranked, q, allTermsWithYears, usedSentences, posPool, tfidfScores),
      ...makeDoubleFill(ranked, q, tfidfScores, allTerms, usedSentences),
      ...makeOrdering(sentencesOrdered, Math.ceil(q / 2), usedSentences),
      ...makeMainIdea(ranked, usedSentences, embeddings, embeddings ? computeCentroid(embeddings) : null),
      ...makeSuperlative(ranked, q, usedSentences),
      ...makeListQuestion(ranked, q, allTerms, usedSentences),
      ...makeCooccurrence(ranked, Math.ceil(q / 2), allTerms, usedSentences),
      ...makeQuantityQuestion(ranked, q, usedSentences),
      ...makeTimeline(ranked, Math.ceil(q / 2), usedSentences),
      ...makeContrast(ranked, q, allTerms, usedSentences),
      ...vocabQs,
      ...errorQs,
      ...cnQs,
      ...makeNotTrue(ranked, Math.ceil(q / 3), allTerms, usedSentences),
      ...makePronounRefQuestions(rawSentences, sentencesOrdered, allTerms, Math.ceil(q / 3), usedSentences),
    ]);
    // Top up with FLAN-T5 if the rule-based pool is thin
    if (pool.length < numQ) {
      const flanRaw = await flanFetch;
      for (const { question, answer, sentence } of flanRaw) {
        if (!question || !answer || answer.split(' ').length > 6) continue;
        if (!questionOk(question)) continue;
        if (usedSentences.has(sentence)) continue;
        const sTerms = extractProperNouns(sentence);
        let distractors = getDistractors(answer, allTerms, detectEntityType(answer), sTerms, posPool, tfidfScores, ranked, sentence);
        distractors = normalizeLengthDistribution(answer, distractors);
        usedSentences.add(sentence);
        if (distractors.length >= 3) {
          const choices = shuffle([answer, ...distractors.slice(0, 3)]);
          pool.push({ type: 'mcq', question, choices, answer: choices.indexOf(answer), difficulty: 'medium', explanation: `From source: "${sentence}"` });
        } else {
          pool.push({ type: 'fill', question, answer, difficulty: 'medium', explanation: `From source: "${sentence}"` });
        }
      }
    }

    // Soft cap: KWIC-blank questions ("Choose the correct answer: / Fill in the blank:")
    // are the lowest-quality format — limit them to at most 35% of the target count.
    const kwicCap = Math.ceil(numQ * 0.35);
    let kwicSeen = 0;
    const cappedPool = pool.filter(q => {
      if (/^(Choose the correct answer|Fill in the blank):/.test(q.question)) {
        return kwicSeen++ < kwicCap;
      }
      return true;
    });
    // Dedup by source sentence before interleaving — parallel branches (used1…used5)
    // each have their own usedSentences so the same sentence can appear in both a TF
    // and a vocab question simultaneously. The answer-dedup below won't catch this
    // since the two questions have different answers.
    const seenSrc = new Set();
    const srcDedupedPool = cappedPool.filter(q => {
      const m = q.explanation?.match(/From source: "(.{20,})/);
      if (!m) return true;
      const key = m[1].slice(0, 60);
      if (seenSrc.has(key)) return false;
      seenSrc.add(key);
      return true;
    });
    qs = interleavedPick(srcDedupedPool, Math.min(srcDedupedPool.length, numQ + 8));
  }
  if (!qs.length) throw new Error("Could not extract enough questions. Try a source with more complete sentences.");

  // Replace hardcoded difficulty labels with TF-IDF-derived scores
  qs = applyDynamicDifficulty(qs, tfidfScores);

  // Deduplicate by answer value — skip TF/ordering (structural answers) and double_fill (uses answers[])
  const usedAnswerKeys = new Set();
  qs = qs.filter(q => {
    if (q.type === 'tf' || q.type === 'ordering') return true;
    // double_fill has no scalar `answer`; use the joined answers array as the key
    const answerStr = q.type === 'double_fill'
      ? (q.answers || []).join('|')
      : (typeof q.answer === "number" ? q.choices?.[q.answer] : q.answer) ?? "";
    const key = String(answerStr).toLowerCase().trim();
    if (!key || usedAnswerKeys.has(key)) return false;
    usedAnswerKeys.add(key);
    return true;
  });

  // Deduplicate by question stem — prevents near-identical question wording
  const usedStemKeys = new Set();
  qs = qs.filter(q => {
    const qStem = q.question.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").slice(0, 60).trim();
    if (usedStemKeys.has(qStem)) return false;
    usedStemKeys.add(qStem);
    return true;
  });

  return qs.slice(0, numQ);
}

// ── PDF text extraction (PDF.js CDN) ─────────────────────────────────────────
export async function extractPdfText(file) {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text;
}
