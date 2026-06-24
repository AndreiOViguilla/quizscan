// Rule-based quiz generator — no LLM calls; uses wink-nlp for POS/NER + spaCy (backend) for dep parsing
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import its from 'wink-nlp/src/its.js';
const wink = winkNLP(model);

// ── Stop words ───────────────────────────────────────────────────────────────
const STOP = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","and","but","or","nor","so","yet","to","of","in","on","at","by","for","with","about","into","from","up","out","over","then","once","also","as","if","while","because","since","although","though","unless","until","when","where","who","which","that","this","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","what","how","all","each","every","some","any","few","more","most","other","such","not","no","only","own","same","than","too","very","just","both","either","neither"]);

// Generic content words that make poor fill-in-the-blank targets
const GENERIC_BLANK_WORDS = new Set(["used","made","came","took","went","said","told","knew","seen","given","called","known","found","many","much","even","part","form","type","kind","ways","time","times","year","years","place","area","world","people","person","thing","things","point","group","number","large","small","long","high","great","well","good","often","later","early","during","within","between","among","based","being","having","making","taking","using","getting","putting","coming","going","looking","working","following","including","different","important","significant","various","several","another","through","across","around","century","country","region","period","process","system","level","term","terms","role","fact","case","way","use","need","also","even","back","just","like","more","less","only","last","next","over","same","still","such","very","well"]);

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
function resolveCoref(sentences) {
  let lastPerson = null;
  let lastPlural = null;
  let lastThing = null;

  return sentences.map(s => {
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

    // Update antecedent tracking from original sentence
    const persons = s.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)?.filter(m => !STOP.has(m.toLowerCase())) || [];
    if (persons.length) {
      // Prefer full names (multi-word) that are not places/orgs
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
        lastPerson = nonPlace || null;
      }
    }
    // Allow capitalized group nouns: "The Romans", "The Americans", "the soldiers"
    const pluralMatch = s.match(/\bThe\s+([A-Za-z][a-z]*s)\b/i);
    if (pluralMatch) lastPlural = pluralMatch[1];
    const thingMatch = s.match(/^([A-Z][A-Za-z\s]{2,25}?)\s+(?:is|was|has|had)\b/);
    if (thingMatch && !persons.length) lastThing = thingMatch[1].trim();

    return resolved;
  });
}

// ── Sentence extraction + scoring ─────────────────────────────────────────────
function scoreSentence(s, idx, total, isParaFirst = false) {
  let score = 0;
  if (isParaFirst) score += 2;
  if (idx < total * 0.2) score += 2;
  if (/\b(is|are|was|were|defined as|refers to|known as|called)\b/i.test(s)) score += 3;
  if (/\b\d{4}\b/.test(s)) score += 2;
  if (/\d+(\.\d+)?(%|million|billion|km|kg)/i.test(s)) score += 2;
  if (/\b[A-Z][a-z]{2,}/.test(s)) score += 1;
  if (/\b(because|therefore|thus|led to|caused|resulted in)\b/i.test(s)) score += 2;
  if (/\b(than|unlike|compared to|whereas|while)\b/i.test(s)) score += 1;
  if (/\b(founded|invented|discovered|created|established|wrote|built|led|won|defeated|conquered|signed|developed|introduced)\b/i.test(s)) score += 2;
  const wc = s.split(" ").length;
  if (wc < 8 || wc > 45) score -= 2;
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

function extractSentences(text, { sorted = true } = {}) {
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
      return true;
    });
  const resolved = resolveCoref(raw);
  const scored = resolved.map((s, i) => ({ s, score: scoreSentence(s, i, resolved.length, paraFirstSet.has(raw[i])) }));
  if (!sorted) return scored.map(x => x.s);
  return scored
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}

// ── TF-IDF ────────────────────────────────────────────────────────────────────
function tfidf(sentences) {
  const docCount = sentences.length;
  const tf = sentences.map(s => {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
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
    // For lowercase-starting terms (common nouns), keep only the first word to avoid "impressed by the"
    if (/^[a-z]/.test(term)) term = term.split(/\s+/)[0];
    if (term.length >= 3 && !STOP.has(term.toLowerCase())) return term;
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
    const scored = properPool.map(w => ({ w, s: tfidfScores[w.toLowerCase()] || 0 })).sort((a, b) => b.s - a.s);
    return scored[0].w;
  }
  const num = sentence.match(/\b\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|percent|%|km|kg|m\b))?\b/i);
  if (num) return num[0];
  return null;
}

const VAGUE_SUBJECT = /^\b(one|some|this|that|any|many|such|another|other|each|every|various|it|there|here|the\s+following)\b/i;

// ── Definition Detection ──────────────────────────────────────────────────────
// Trim a definition string to the first natural clause boundary (max 8 words)
// so MCQ answer choices don't span multiple lines.
function trimDefinition(def) {
  // Cut at clause-separating comma/semicolon followed by a connective or capital
  const clauseEnd = def.search(/[,;]\s+(?:and|or|but|which|that|where|when|although|while|though|however|including|such as|especially|particularly|notably)/i);
  if (clauseEnd >= 20) return def.slice(0, clauseEnd).trim();
  const words = def.split(" ");
  return words.length > 9 ? words.slice(0, 9).join(" ") : def;
}

function extractDefinition(sentence) {
  const defMatch = sentence.match(
    /^([A-Z][A-Za-z\s]{1,40}?)\s+(?:is|are|was|were|refers to|is defined as|is known as)\s+(?:a |an |the )?(.{10,})/
  );
  if (defMatch) {
    const subject = defMatch[1].trim();
    const definition = trimDefinition(defMatch[2].replace(/[.!?]+$/, "").trim());
    if (subject.split(" ").length <= 5 && definition.split(" ").length >= 3 && !VAGUE_SUBJECT.test(subject)) return { subject, definition };
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
    const cause = becauseM[2].replace(/[.!?]+$/, "");
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
      const q = `Who ${root.lemma}d ${passSubj.text}?`;
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

function makeDepParseQuestions(parseResults, allTerms, usedSentences) {
  const out = [];
  for (const result of parseResults) {
    const q = makeDepParseQuestion(result);
    if (!q || usedSentences.has(q.sentence)) continue;
    const sTerms = extractProperNouns(q.sentence);
    const distractors = getDistractors(q.answer, allTerms, q.type, sTerms);
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
    const rest = sentence.slice(personSubject[1].length).trim();
    return { question: `Who ${rest.replace(/[.!?]+$/, "")}?`, answer: personSubject[1], type: "person" };
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
  const yearMatch = sentence.match(/\b(in\s+)?(\d{4})\b/);
  if (yearMatch) {
    const before = sentence.slice(0, sentence.indexOf(yearMatch[0]));
    const monthPrecedes = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{0,2}\s*$/.test(before);
    const replacement = yearMatch[1] ? "in what year" : monthPrecedes ? "of what year" : "what year";
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

// ── Smart distractor generation ───────────────────────────────────────────────
// sentenceTerms: proper nouns from the same sentence — used first as more believable wrong answers
function getDistractors(answer, allTerms, type, sentenceTerms = []) {
  if (type === "year") {
    const y = parseInt(answer);
    return shuffle([y - 5, y + 5, y - 10, y + 10, y - 1, y + 1].filter(n => n !== y && n > 1000 && n < 2100)).slice(0, 3).map(String);
  }
  if (type === "number") {
    const n = parseFloat(answer.replace(/,/g, ""));
    return [Math.round(n * 0.5), Math.round(n * 1.5), Math.round(n * 2)].filter(x => x !== n).slice(0, 3).map(String);
  }
  // Common-noun answers: return [] so callers use Datamuse for semantically relevant distractors
  if (/^[a-z]/.test(answer)) return [];
  // Prefer same-sentence terms as contextually believable distractors
  const sameS = sentenceTerms.filter(t => t !== answer && t.length > 2);
  if (type === "person") {
    const pool = [...new Set([...sameS, ...allTerms])].filter(t => t !== answer);
    // Full names first; fall back to single-name proper nouns (e.g. Socrates, Mozart)
    const fullNames = pool.filter(t => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t));
    const singleNames = pool.filter(t => /^[A-Z][a-z]{2,}$/.test(t) && detectEntityType(t) !== "place");
    const people = [...new Set([...fullNames, ...singleNames])];
    if (people.length >= 3) return shuffle(people).slice(0, 3);
  }
  if (type === "place") {
    const places = [...new Set([...sameS, ...allTerms])].filter(t => detectEntityType(t) === "place" && t !== answer);
    if (places.length >= 3) return shuffle(places).slice(0, 3);
  }
  if (sameS.length >= 3) return shuffle(sameS).slice(0, 3);
  // Type-matched fallback: prefer same entity type before falling back to anything
  const targetType = detectEntityType(answer);
  if (targetType !== "noun") {
    const sameType = allTerms.filter(t => t !== answer && t.length > 2 && detectEntityType(t) === targetType);
    if (sameType.length >= 3) return shuffle(sameType).slice(0, 3);
  }
  return shuffle(allTerms.filter(t => t !== answer && t.length > 2)).slice(0, 3);
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
  if (verbMatch) return sentence.replace(verbMatch[0], `${verbMatch[0]} not`);
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
  return true;
}

// ── Diversity-aware question picker ──────────────────────────────────────────
// Round-robins across question types so the final quiz isn't a run of same-type questions.
function interleavedPick(pool, count) {
  if (pool.length <= count) return pool;
  const byType = {};
  for (const q of shuffle(pool)) {
    (byType[q.type] = byType[q.type] || []).push(q);
  }
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
      usedSentences.add(s);
      out.push({ type: "fill", question: wh.question, answer: wh.answer, difficulty: "medium", explanation: `From source: "${s}"` });
      continue;
    }
    const term = extractKeyTerm(s, tfidfScores);
    if (!term) continue;
    const kwic = makeKwicBlank(s, term);
    if (!kwic) continue;
    const q = `Fill in the blank: "${kwic}"`;
    if (!questionOk(q)) continue;
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
      const signal = AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined;
      const res = await fetch(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=3`, { signal });
      if (!res.ok) continue;
      const data = await res.json();
      const ant = (Array.isArray(data) ? data : []).map(d => d.word).find(w => w && !w.includes(" "));
      if (!ant) continue;
      const replacement = raw[0] === raw[0].toUpperCase() ? ant.charAt(0).toUpperCase() + ant.slice(1) : ant;
      return sentence.slice(0, index) + replacement + sentence.slice(index + raw.length);
    } catch {}
  }
  return null;
}

async function makeTF(sentences, count, allEntities, usedSentences) {
  const out = [];
  const NEGATION = /\b(not|never|no one|nobody|nothing|nowhere|neither|nor|without|lack|absence)\b/i;
  // Unresolved pronoun as subject — context-free, ambiguous as a standalone statement
  const BARE_PRONOUN_SUBJECT = /^(He|She|It|They)\b/;
  // Mid-clause pronoun as main subject after a comma — e.g. "Like X, it was designed..."
  const MID_CLAUSE_PRONOUN = /,\s+(it|he|she|they|them)\s+\b(was|is|were|are|had|has|did|could|would)\b/i;
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const q = s.replace(/[.!?]+$/, "");
    if (!questionOk(q)) continue;
    if (Math.random() > 0.4) {
      if (NEGATION.test(s)) continue;
      if (BARE_PRONOUN_SUBJECT.test(s)) continue;
      if (MID_CLAUSE_PRONOUN.test(s)) continue;
      usedSentences.add(s);
      out.push({ type: "tf", question: q, answer: "True", difficulty: "easy", explanation: "This statement appears directly in the source." });
    } else {
      // Try antonym swap via Datamuse first for a more believable false statement
      let neg = typeof negateWithDatamuse === "function" ? await negateWithDatamuse(s) : null;
      if (!neg) neg = negateSentence(s, allEntities);
      if (neg && questionOk(neg)) {
        usedSentences.add(s);
        out.push({ type: "tf", question: neg.replace(/[.!?]+$/, ""), answer: "False", difficulty: "medium", explanation: `Correct: "${s}"` });
      }
    }
  }
  return out;
}

async function makeMCQ(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const sTerms = extractProperNouns(s);

    const def = extractDefinition(s);
    if (def) {
      const defQ = `What is described as "${def.definition}"?`;
      const defDistractors = allTerms.filter(t => t !== def.subject && t.split(" ").length <= 3);
      if (questionOk(defQ) && defDistractors.length >= 3) {
        const choices = shuffle([def.subject, ...shuffle(defDistractors).slice(0, 3)]);
        usedSentences.add(s);
        out.push({ type: "mcq", question: defQ, choices, answer: choices.indexOf(def.subject), difficulty: "medium", explanation: `From source: "${s}"` });
        continue;
      }
    }

    const sStripped = stripEmbeddedClauses(s);
    const wh = toWhQuestion(s) || (sStripped !== s ? toWhQuestion(sStripped) : null);
    if (wh && questionOk(wh.question)) {
      let distractors = getDistractors(wh.answer, allTerms, wh.type, sTerms);
      // Datamuse fallback for common-word answers (non-proper-noun, non-number)
      if (distractors.length < 3 && !/^[A-Z]/.test(wh.answer) && !/^\d/.test(wh.answer)) {
        try {
          const signal = AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined;
          const [antRes, trgRes, synRes] = await Promise.all([
            fetch(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(wh.answer.toLowerCase())}&max=5`, { signal }),
            fetch(`/api/lookup?service=datamuse&rel_trg=${encodeURIComponent(wh.answer.toLowerCase())}&max=8`, { signal }),
            fetch(`/api/lookup?service=datamuse&rel_syn=${encodeURIComponent(wh.answer.toLowerCase())}&max=5`, { signal }),
          ]);
          const [antData, trgData, synData] = await Promise.all([antRes.ok ? antRes.json() : [], trgRes.ok ? trgRes.json() : [], synRes.ok ? synRes.json() : []]);
          const apiWords = [...antData, ...trgData, ...synData].map(d => d.word).filter(w => w && !w.includes(" ") && w !== wh.answer.toLowerCase());
          if (apiWords.length >= 3) distractors = shuffle(apiWords).slice(0, 3);
        } catch {}
      }
      if (distractors.length < 3) continue;
      const choices = shuffle([wh.answer, ...distractors.slice(0, 3)]);
      usedSentences.add(s);
      out.push({ type: "mcq", question: wh.question, choices, answer: choices.indexOf(wh.answer), difficulty: "medium", explanation: `From source: "${s}"` });
      continue;
    }

    const answer = extractKeyTerm(s, tfidfScores);
    if (!answer) continue;
    const kwic = makeKwicBlank(s, answer);
    if (!kwic) continue;
    const kwicQ = `Choose the correct answer: "${kwic}"`;
    if (!questionOk(kwicQ)) continue;
    const type = detectEntityType(answer);
    let distractors = getDistractors(answer, allTerms, type, sTerms);
    // Datamuse fallback for common-word answers (non-proper-noun, non-number)
    if (distractors.length < 3 && !/^[A-Z]/.test(answer) && !/^\d/.test(answer)) {
      try {
        const signal = AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined;
        const [antRes, trgRes, synRes] = await Promise.all([
          fetch(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(answer.toLowerCase())}&max=5`, { signal }),
          fetch(`/api/lookup?service=datamuse&rel_trg=${encodeURIComponent(answer.toLowerCase())}&max=8`, { signal }),
          fetch(`/api/lookup?service=datamuse&rel_syn=${encodeURIComponent(answer.toLowerCase())}&max=5`, { signal }),
        ]);
        const [antData, trgData, synData] = await Promise.all([antRes.ok ? antRes.json() : [], trgRes.ok ? trgRes.json() : [], synRes.ok ? synRes.json() : []]);
        const apiWords = [...antData, ...trgData, ...synData].map(d => d.word).filter(w => w && !w.includes(" ") && w !== answer.toLowerCase());
        if (apiWords.length >= 3) distractors = shuffle(apiWords).slice(0, 3);
      } catch {}
    }
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
    if (!ce || !questionOk(ce.question) || ce.answer.length < 5 || ce.answer.length > 60) continue;
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
    if (!seq || !questionOk(seq.question) || seq.answer.length < 5 || seq.answer.length > 60) continue;
    usedSentences.add(s);
    out.push({ type: "fill", question: seq.question, answer: trimAnswer(seq.answer), difficulty: "medium", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Comparison questions ──────────────────────────────────────────────────────
function makeComparison(sentences, count, allTerms, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const cmp = extractComparison(s);
    if (!cmp) continue;
    const sTerms = extractProperNouns(s);
    const distractors = getDistractors(cmp.answer, allTerms, "noun", sTerms);
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

// ── Double-blank questions ────────────────────────────────────────────────────
function makeDoubleFill(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));

  const wordFreq = {};
  sentences.forEach(s => {
    (s.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      .filter(w => !STOP.has(w) && !properLower.has(w) && !GENERIC_BLANK_WORDS.has(w))
      .forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
  });
  const fullTerms = Object.keys(wordFreq)
    .map(w => ({ w, score: tfidfScores[w] || tfidfScores[w.replace(/(?:ers?|ing|ed|ly|ness|tion)$/, "")] || 0 }))
    .sort((a, b) => b.score - a.score)
    .map(({ w }) => w);

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
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
    const distractors = shuffle(fullTerms.filter(t => !answers.includes(t) && t.length > 3)).slice(0, 2);
    if (distractors.length < 2) continue;

    // Capitalize first letter for display; original sentence case preserved via comparison being case-insensitive
    const capitalize = w => w.charAt(0).toUpperCase() + w.slice(1);
    const choices = shuffle([...answers, ...distractors].map(capitalize));

    usedSentences.add(s);
    out.push({ type: "double_fill", question, answers, choices, difficulty: "hard", explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Datamuse: antonyms + triggers + synonyms, always mixed with text pool ─────
async function fetchDatamuseDistractors(word, textPool) {
  const lenMin = word.length - 3, lenMax = word.length + 5;
  let apiWords = [];
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined;
    const [antRes, trgRes, synRes] = await Promise.all([
      fetch(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=8`, { signal }),
      fetch(`/api/lookup?service=datamuse&rel_trg=${encodeURIComponent(word)}&max=12`, { signal }),
      fetch(`/api/lookup?service=datamuse&rel_syn=${encodeURIComponent(word)}&max=8`, { signal }),
    ]);
    const [antData, trgData, synData] = await Promise.all([
      antRes.ok ? antRes.json() : Promise.resolve([]),
      trgRes.ok ? trgRes.json() : Promise.resolve([]),
      synRes.ok ? synRes.json() : Promise.resolve([]),
    ]);
    // Prioritise antonyms (clearly wrong), then triggers (same topic), then synonyms (close but distinct)
    apiWords = [...antData, ...trgData, ...synData]
      .map(d => (d.word || "").toLowerCase())
      .filter(w => w && w !== word && !w.includes(" ") && w.length >= lenMin && w.length <= lenMax);
  } catch {}

  const textWords = textPool.filter(t => t !== word && t.length >= lenMin && t.length <= lenMax);
  const combined = [...new Set([...apiWords, ...textWords])];
  if (combined.length >= 3) return shuffle(combined).slice(0, 3);

  const any = textPool.filter(t => t !== word);
  return shuffle(any).slice(0, 3);
}

// ── Vocabulary-in-context questions ──────────────────────────────────────────
async function makeVocabContext(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));

  // Build pool of FULL words (not TF-IDF stems) from the text
  const wordFreq = {};
  sentences.forEach(s => {
    (s.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      .filter(w => !STOP.has(w) && !properLower.has(w) && !GENERIC_BLANK_WORDS.has(w))
      .forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
  });
  // Score full words using their TF-IDF score (or their stem's score as fallback)
  const fullVocabTerms = Object.keys(wordFreq)
    .map(w => ({ w, score: tfidfScores[w] || tfidfScores[w.replace(/(?:ers?|ing|ed|ly|ness|tion)$/, "")] || 0 }))
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

    // Fetch semantically related words + antonyms from Datamuse; fall back to text pool
    const distractors = await fetchDatamuseDistractors(matched, fullVocabTerms);
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
function makeMainIdea(sentences, usedSentences) {
  const available = sentences.filter(s => !usedSentences.has(s));
  if (available.length < 4) return [];
  const mainIdea = available[0];
  const distractors = available.slice(1, 4);
  const choices = shuffle([mainIdea, ...distractors]).map(c => c.length > 120 ? c.slice(0, 117) + "..." : c);
  const answerIdx = choices.findIndex(c => c.startsWith(mainIdea.slice(0, 30)));
  usedSentences.add(mainIdea);
  return [{ type: "mcq", question: "Which sentence best states the main idea of the passage?", choices, answer: answerIdx, difficulty: "medium", explanation: `Main idea: "${mainIdea}"` }];
}

// ── Ordering questions ────────────────────────────────────────────────────────
function makeOrdering(orderedSentences, count, usedSentences) {
  const out = [];
  const SEQ = /\b(first|second|then|next|after|before|finally|initially|later|meanwhile|subsequently|afterward)\b/i;
  for (let i = 0; i <= orderedSentences.length - 3 && out.length < count; i++) {
    const group = orderedSentences.slice(i, i + 3);
    if (group.some(s => usedSentences.has(s))) continue;
    // Require at least 1 sequence signal word (was: all 3 must have one)
    if (!group.some(s => SEQ.test(s))) continue;
    // Require at least 2 of 3 sentences to pass quality check (was: all 3)
    if (group.filter(s => questionOk(s)).length < 2) continue;
    const correct = [...group];
    let scrambled = shuffle([...group]);
    let tries = 0;
    while (scrambled.every((s, j) => s === correct[j]) && tries++ < 10) scrambled = shuffle([...group]);
    group.forEach(s => usedSentences.add(s));
    out.push({ type: "ordering", question: "Arrange these sentences in the correct order:", items: scrambled, answers: correct, difficulty: "hard", explanation: `Correct order: 1. "${correct[0].slice(0, 60)}..." 2. "${correct[1].slice(0, 60)}..." 3. "${correct[2].slice(0, 60)}..."` });
  }
  return out;
}

// ── Error Identification questions ────────────────────────────────────────────
async function makeErrorId(sentences, count, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const wordRe = /\b([a-z]{4,})\b/gi;
    const candidates = [];
    let m;
    while ((m = wordRe.exec(s)) !== null) {
      const w = m[1].toLowerCase();
      if (STOP.has(w)) continue;
      const pos = inferPos(w, s.slice(0, m.index));
      if (pos === "adj" || pos === "adv") candidates.push({ word: w, index: m.index, raw: m[1] });
    }
    if (!candidates.length) continue;
    let swapped = null, errorWord = null, errorOriginal = null;
    for (const { word, index, raw } of shuffle(candidates).slice(0, 4)) {
      try {
        const signal = AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined;
        const res = await fetch(`/api/lookup?service=datamuse&rel_ant=${encodeURIComponent(word)}&max=3`, { signal });
        if (!res.ok) continue;
        const data = await res.json();
        const ant = data.map(d => d.word).find(w => w && !w.includes(" "));
        if (!ant) continue;
        const replacement = raw[0] === raw[0].toUpperCase() ? ant.charAt(0).toUpperCase() + ant.slice(1) : ant;
        swapped = s.slice(0, index) + replacement + s.slice(index + raw.length);
        errorWord = replacement; errorOriginal = raw;
        break;
      } catch {}
    }
    if (!swapped || !errorWord) continue;
    // Find 3 other nouns/content words as decoy spans
    const decoys = [];
    const decoyRe = /\b([A-Za-z]{4,})\b/g;
    while ((m = decoyRe.exec(swapped)) !== null) {
      const w = m[1];
      if (w.toLowerCase() === errorWord.toLowerCase() || STOP.has(w.toLowerCase())) continue;
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
      const unit = pctM[2];
      const delta = Math.max(5, Math.round(n * 0.3));
      const q = s.replace(pctM[0], `____${unit}`).replace(/[.!?]+$/, "");
      if (!questionOk(q)) continue;
      const choices = shuffle([
        pctM[0],
        `${Math.round(Math.max(0, n - delta))}${unit}`,
        `${Math.round(n + delta)}${unit}`,
        `${Math.round(n * 2 > 100 ? n / 2 : n * 2)}${unit}`,
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
    const yr = parseInt(m[1]);
    if (!byYear[yr]) byYear[yr] = s;
  }
  const events = Object.entries(byYear)
    .map(([yr, s]) => ({ year: parseInt(yr), s }))
    .sort((a, b) => a.year - b.year);

  if (events.length < 4) return out;

  const shorten = s => s.length > 78 ? s.slice(0, 75) + "..." : s.replace(/[.!?]+$/, "");

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

    if (rightSubj && /^[A-Z]/.test(rightSubj) && !STOP.has(rightSubj.toLowerCase()) && leftSubj) {
      // Proper-noun contrast → MCQ
      const question = `According to the passage, what is contrasted with "${leftSubj}"?`;
      if (!questionOk(question)) continue;
      const distractors = shuffle(allTerms.filter(t => t !== leftSubj && t !== rightSubj && t.length > 2)).slice(0, 3);
      if (distractors.length < 3) continue;
      const choices = shuffle([rightSubj, ...distractors]);
      usedSentences.add(s);
      out.push({ type: "mcq", question, choices, answer: choices.indexOf(rightSubj), difficulty: "medium", explanation: `From source: "${s}"` });
    } else {
      // Common-noun or abstract contrast → fill question
      const shortRight = trimAnswer(right, 60);
      if (shortRight.length < 5) continue;
      const question = `"${trimAnswer(left, 70)}…" — what does the passage contrast this with?`;
      if (!questionOk(question)) continue;
      usedSentences.add(s);
      out.push({ type: "fill", question, answer: shortRight, difficulty: "medium", explanation: `From source: "${s}"` });
    }
  }
  return out;
}

// ── TextRank sentence ranking ─────────────────────────────────────────────────
function textRank(sentences, iterations = 30, damping = 0.85) {
  const n = sentences.length;
  if (n < 3) return sentences;
  const cap = Math.min(n, 60);
  const capped = sentences.slice(0, cap);

  const wordSets = capped.map(s =>
    new Set(s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))
  );

  function sim(i, j) {
    const a = wordSets[i], b = wordSets[j];
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (Math.log2(a.size + 1) + Math.log2(b.size + 1) + 1e-6);
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
      question = `What was ${superlative.toLowerCase()}?`;
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
    if (items.some(item => item.length > 35 || item.split(" ").length > 4)) continue;
    if (items.some(item => STOP.has(item.toLowerCase()))) continue;

    const distractor = shuffle(allTerms.filter(t => !items.includes(t) && t.length > 2))[0];
    if (!distractor) continue;

    // Extract the subject phrase before the verb for the question
    const categoryMatch = s.match(/^(.{5,55}?)\s+(?:were|was|are|is|included?|consisted of|comprised)/i);
    const category = categoryMatch
      ? categoryMatch[1].trim().toLowerCase()
      : "the items listed";

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
    const concepts = (s.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
      .filter(w => !STOP.has(w) && !GENERIC_BLANK_WORDS.has(w) && !MONTHS_SET.has(w) && !properLower.has(w));
    for (const entity of entities) {
      for (const concept of [...new Set(concepts)]) {
        const key = `${entity}|||${concept}`;
        coCount[key] = (coCount[key] || 0) + 1;
      }
    }
  }

  // Sort by co-occurrence count, highest first
  const pairs = Object.entries(coCount)
    .filter(([, c]) => c >= 2)
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

    // Distractors: top concepts associated with OTHER entities
    const distractors = [...new Set(
      pairs
        .filter(([k]) => !k.startsWith(`${entity}|||`))
        .map(([k]) => k.split("|||")[1])
        .filter(c => c !== concept)
    )].slice(0, 6);
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
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    if (!questionOk(s.replace(/[.!?]+$/, ""))) continue;
    const falseVer = negateSentence(s, allTerms);
    if (!falseVer || falseVer === s) continue;
    const falseText = falseVer.replace(/[.!?]+$/, "").slice(0, 110);
    // Three true sentences as distractors (trimmed for display)
    const trues = shuffle(sentences.filter(x => x !== s && !usedSentences.has(x)))
      .slice(0, 3)
      .map(x => x.replace(/[.!?]+$/, "").slice(0, 110));
    if (trues.length < 3) continue;
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

  // Pick top TF-IDF terms (noun-like: 4+ chars, no stop words, not all-caps acronym)
  const topTerms = Object.entries(tfidfScores)
    .filter(([w]) => w.length >= 4 && !STOP.has(w) && !GENERIC_BLANK_WORDS.has(w) && !/^[A-Z]{2,}$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

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
    const edge = candidates[0];
    const relId = edge.rel["@id"];
    const answer = edge.end.label.toLowerCase();
    const questionText = CN_REL[relId](term);

    // Build distractors from same-relation pool, excluding the answer
    const pool = [...(relPool[relId] || [])].filter(w => w !== answer);
    if (pool.length < 3) continue;

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

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateNoAiQuiz(text, numQ, qType, lang = "English") {
  if (text.length > 50000) text = text.slice(0, 50000);
  const sentences = extractSentences(text);
  const sentencesOrdered = extractSentences(text, { sorted: false });
  if (sentences.length < 5) throw new Error("Not enough content to generate questions. Try adding more text.");

  const tfidfScores = tfidf(sentences);
  const allTerms = [...new Set(sentences.flatMap(s => extractProperNouns(s)))];
  const usedSentences = new Set();

  // TextRank: graph-based sentence ranking as fallback (more reliable than raw TF-IDF order)
  let ranked = textRank(sentences);

  // Neural re-ranking + spaCy dep parse run in parallel
  const batch = ranked.slice(0, 40);
  const [embeddings, parseResults] = await Promise.all([
    fetchEmbeddings(batch),
    parseWithSpacy(ranked.slice(0, 20)),
  ]);
  if (embeddings) {
    const centroid = computeCentroid(embeddings);
    const neuralScored = batch.map((s, i) => ({ s, score: cosineSimilarity(embeddings[i], centroid) }));
    neuralScored.sort((a, b) => b.score - a.score);
    ranked = [...neuralScored.map(x => x.s), ...ranked.slice(40)];
  }

  let qs;
  if (qType === "fill") {
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTerms, depUsed);
    [...depUsed].forEach(s => usedSentences.add(s));
    qs = shuffle([...depQs, ...makeFill(ranked, numQ, tfidfScores, usedSentences)]).slice(0, numQ);
  }
  else if (qType === "tf") qs = await makeTF(ranked, numQ, allTerms, usedSentences);
  else if (qType === "mcq") {
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTerms, depUsed).filter(q => q.type === 'mcq');
    [...depUsed].forEach(s => usedSentences.add(s));
    qs = shuffle([...depQs, ...await makeMCQ(ranked, numQ, tfidfScores, allTerms, usedSentences)]).slice(0, numQ);
  }
  else if (qType === "double_fill") qs = makeDoubleFill(ranked, numQ, tfidfScores, allTerms, usedSentences);
  else if (qType === "ordering") qs = makeOrdering(sentencesOrdered, numQ, usedSentences);
  else if (qType === "error_id") qs = await makeErrorId(ranked, numQ, usedSentences);
  else {
    // Mixed: generate from all types, shuffle, take numQ
    const q = Math.ceil(numQ / 3);
    // Each parallel function gets its own usedSentences to prevent mid-await races
    const used1 = new Set(), used2 = new Set(), used3 = new Set(), used4 = new Set(), used5 = new Set();
    const [tfQs, vocabQs, mcqQs, errorQs, cnQs] = await Promise.all([
      makeTF(ranked, q, allTerms, used1),
      makeVocabContext(ranked, q, tfidfScores, allTerms, used2),
      makeMCQ(ranked, q, tfidfScores, allTerms, used3),
      makeErrorId(ranked, Math.ceil(q / 2), used4),
      makeConceptNetQuestion(ranked, Math.ceil(q / 2), tfidfScores, allTerms, used5),
    ]);
    // Merge into shared set so sequential builders below don't reuse these sentences
    [...used1, ...used2, ...used3, ...used4, ...used5].forEach(s => usedSentences.add(s));
    const depUsed = new Set();
    const depQs = makeDepParseQuestions(parseResults, allTerms, depUsed);
    [...depUsed].forEach(s => usedSentences.add(s));
    const pool = shuffle([
      ...mcqQs,
      ...tfQs,
      ...depQs,
      ...makeFill(ranked, q, tfidfScores, usedSentences),
      ...makeCauseEffect(ranked, q, usedSentences),
      ...makeSequence(ranked, q, usedSentences),
      ...makeComparison(ranked, q, allTerms, usedSentences),
      ...makeDoubleFill(ranked, q, tfidfScores, allTerms, usedSentences),
      ...makeOrdering(sentencesOrdered, Math.ceil(q / 2), usedSentences),
      ...makeMainIdea(ranked, usedSentences),
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
    ]);
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
    qs = interleavedPick(cappedPool, numQ);
  }
  if (!qs.length) throw new Error("Could not extract enough questions. Try a source with more complete sentences.");

  // Deduplicate by answer value — prevents the same year/person/term appearing as the answer repeatedly
  const usedAnswerKeys = new Set();
  qs = qs.filter(q => {
    const answerStr = (typeof q.answer === "number" ? q.choices?.[q.answer] : q.answer) ?? "";
    const key = String(answerStr).toLowerCase().trim();
    if (!key || usedAnswerKeys.has(key)) return false;
    usedAnswerKeys.add(key);
    return true;
  });

  // Deduplicate by question stem — prevents near-identical question wording even with different answers
  const usedStemKeys = new Set();
  qs = qs.filter(q => {
    const stem = q.question.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").slice(0, 60).trim();
    if (usedStemKeys.has(stem)) return false;
    usedStemKeys.add(stem);
    return true;
  });

  return qs;
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
