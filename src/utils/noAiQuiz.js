// Rule-based quiz generator — no AI, no external libraries

// ── Stop words ───────────────────────────────────────────────────────────────
const STOP = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","and","but","or","nor","so","yet","to","of","in","on","at","by","for","with","about","into","from","up","out","over","then","once","also","as","if","while","because","since","although","though","unless","until","when","where","who","which","that","this","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","what","how","all","each","every","some","any","few","more","most","other","such","not","no","only","own","same","than","too","very","just","both","either","neither"]);

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
      resolved = resolved.replace(/\b(They|Them|Their)\b/g, (m) => {
        return m.toLowerCase() === "their" ? `${lastPlural}'s` : lastPlural;
      });
    }
    if (lastThing) {
      resolved = resolved.replace(/\bIt\b/g, lastThing);
    }

    // Update antecedent tracking from original sentence
    const persons = s.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g)?.filter(m => !STOP.has(m.toLowerCase())) || [];
    if (persons.length) {
      // Prefer full names (multi-word), otherwise last non-place entity (most recently introduced)
      const multiWord = persons.find(p => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(p));
      if (multiWord) {
        lastPerson = multiWord;
      } else {
        const nonPlace = [...persons].reverse().find(p => detectEntityType(p) !== "place");
        lastPerson = nonPlace || persons[persons.length - 1];
      }
    }
    const pluralMatch = s.match(/\bThe\s+([a-z]+s)\b/);
    if (pluralMatch) lastPlural = pluralMatch[1];
    const thingMatch = s.match(/^([A-Z][A-Za-z\s]{2,25}?)\s+(?:is|was|has|had)\b/);
    if (thingMatch && !persons.length) lastThing = thingMatch[1].trim();

    return resolved;
  });
}

// ── Sentence extraction + scoring ─────────────────────────────────────────────
function scoreSentence(s, idx, total) {
  let score = 0;
  if (idx < total * 0.2) score += 2;
  if (/\b(is|are|was|were|defined as|refers to|known as|called)\b/i.test(s)) score += 3;
  if (/\b\d{4}\b/.test(s)) score += 2;
  if (/\d+(\.\d+)?(%|million|billion|km|kg)/i.test(s)) score += 2;
  if (/\b[A-Z][a-z]{2,}/.test(s)) score += 1;
  if (/\b(because|therefore|thus|led to|caused|resulted in)\b/i.test(s)) score += 2;
  if (/\b(than|unlike|compared to|whereas|while)\b/i.test(s)) score += 1;
  const wc = s.split(" ").length;
  if (wc < 8 || wc > 45) score -= 2;
  return score;
}

function extractSentences(text) {
  const HAS_VERB = /\b(is|are|was|were|had|has|did|do|does|said|told|made|went|came|felt|looked|asked|moved|played|built|wrote|found|knew|wanted|liked|began|started|ended|called|named|liked|showed|gave|took|kept|left|put|got|set|ran|saw|thought|brought|bought|tried|heard|felt|stood|fell|held|grew|sent|met|led|read|lost|spent|born|raised|died|lived)\b/i;
  const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
  const raw = cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z"(])/)
    .map(s => s.trim())
    .filter(s => {
      if (s.length <= 35 || s.split(" ").length < 6) return false;
      // Reject sentences that are too long to make clean questions
      if (s.length > 350) return false;
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
      // Reject sentences still containing web UI residue
      if (/\b(IconBritannica|Ask\s*Anything|Quick\s*Summary|Related\s*Questions?|Britannica\s*AI)\b/i.test(s)) return false;
      // Reject image caption fragments (pattern: "N of N [proper noun] [action verb]...")
      if (/^\d+\s+of\s+\d+\s+[A-Z]/.test(s)) return false;
      return true;
    });
  const resolved = resolveCoref(raw);
  return resolved
    .map((s, i) => ({ s, score: scoreSentence(s, i, resolved.length) }))
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
function detectEntityType(term) {
  if (/^\d{4}$/.test(term)) return "year";
  if (/^\d/.test(term)) return "number";
  if (/^(Dr|Mr|Mrs|Ms|Prof|President|King|Queen|Sir|Gen|Lt|Capt)\b/i.test(term)) return "person";
  if (/\b(City|Island|River|Mountain|Ocean|Sea|Lake|Street|Avenue|Republic|Kingdom|Empire|Province|State|County)\b/i.test(term)) return "place";
  if (/\b(University|College|Institute|Corporation|Company|Association|Organization|Department|Ministry|Agency|Committee|Council)\b/i.test(term)) return "org";
  return "noun";
}

function extractProperNouns(text) {
  const matches = text.match(/\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){0,3}/g) || [];
  return [...new Set(matches.filter(m => !STOP.has(m.toLowerCase()) && m.length > 3))];
}

function extractKeyTerm(sentence, tfidfScores) {
  const afterVerb = sentence.match(/\b(?:is|are|was|were|called|known as|defined as|refers to)\s+(?:a |an |the )?([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,2})/);
  if (afterVerb) return afterVerb[1];
  const multiWordProper = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g) || [];
  if (multiWordProper.length) return multiWordProper[0];
  const singleProper = sentence.match(/\b[A-Z][a-z]{3,}\b/g) || [];
  const filteredProper = singleProper.filter(w => !STOP.has(w.toLowerCase()));
  if (filteredProper.length) {
    const scored = filteredProper.map(w => ({ w, s: tfidfScores[w.toLowerCase()] || 0 })).sort((a, b) => b.s - a.s);
    if (scored[0].s > 0) return scored[0].w;
    return filteredProper[0];
  }
  const num = sentence.match(/\b\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|percent|%|km|kg|m\b))?\b/i);
  if (num) return num[0];
  return null;
}

// ── Definition Detection ──────────────────────────────────────────────────────
function extractDefinition(sentence) {
  const defMatch = sentence.match(
    /^([A-Z][A-Za-z\s]{1,40}?)\s+(?:is|are|was|were|refers to|is defined as|is known as)\s+(?:a |an |the )?(.{10,})/
  );
  if (!defMatch) return null;
  const subject = defMatch[1].trim();
  const definition = defMatch[2].replace(/[.!?]+$/, "").trim();
  if (subject.split(" ").length > 5) return null;
  if (definition.split(" ").length < 3) return null;
  return { subject, definition };
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
  // "Unlike X, Y..." → "How does Y differ from X?"
  const unlikeM = sentence.match(/^Unlike\s+([A-Z][A-Za-z\s]{1,30}?),\s+([A-Z][A-Za-z\s]{1,30}?)\s+/);
  if (unlikeM) {
    const other = unlikeM[1].trim();
    const subject = unlikeM[2].trim();
    return { question: `How does ${subject} differ from ${other}?`, answer: sentence.replace(/[.!?]+$/, "") };
  }
  return null;
}

// ── Wh-question generation ────────────────────────────────────────────────────
function toWhQuestion(sentence) {
  const personSubject = sentence.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(was|is|were|are|had|has|did|became|founded|invented|discovered|wrote|created|built|led|won|lost)/);
  if (personSubject) {
    const rest = sentence.slice(personSubject[1].length).trim();
    return { question: `Who ${rest.replace(/[.!?]+$/, "")}?`, answer: personSubject[1], type: "person" };
  }
  const yearMatch = sentence.match(/\b(in\s+)?(\d{4})\b/);
  if (yearMatch) {
    const q = sentence.replace(yearMatch[0], "when").replace(/[.!?]+$/, "");
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
  return null;
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
  // Prefer same-sentence terms as contextually believable distractors
  const sameS = sentenceTerms.filter(t => t !== answer && t.length > 2);
  if (type === "person") {
    const people = [...new Set([...sameS, ...allTerms])].filter(t => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t) && t !== answer);
    if (people.length >= 3) return shuffle(people).slice(0, 3);
  }
  if (type === "place") {
    const places = [...new Set([...sameS, ...allTerms])].filter(t => detectEntityType(t) === "place" && t !== answer);
    if (places.length >= 3) return shuffle(places).slice(0, 3);
  }
  if (sameS.length >= 3) return shuffle(sameS).slice(0, 3);
  return shuffle(allTerms.filter(t => t !== answer && t.length > 2)).slice(0, 3);
}

// ── Better T/F — Named Entity Swapping ───────────────────────────────────────
function negateSentence(sentence, allEntities) {
  const entities = extractProperNouns(sentence);
  const swappable = entities.filter(e => allEntities.some(a => a !== e));
  if (swappable.length > 0) {
    const target = swappable[Math.floor(Math.random() * swappable.length)];
    const replacement = shuffle(allEntities.filter(a => a !== target))[0];
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

// ── Answer trimmer ────────────────────────────────────────────────────────────
function trimAnswer(text, maxLen = 80) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function questionOk(q) {
  return typeof q === "string" && q.length >= 10 && q.length <= 250;
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
  const idx = sentence.indexOf(term);
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
    const wh = toWhQuestion(s);
    if (wh && questionOk(wh.question)) {
      usedSentences.add(s);
      out.push({ type: "fill", question: wh.question, answer: wh.answer, explanation: `From source: "${s}"` });
      continue;
    }
    const term = extractKeyTerm(s, tfidfScores);
    if (!term) continue;
    const kwic = makeKwicBlank(s, term);
    if (!kwic) continue;
    const q = `Fill in the blank: "${kwic}"`;
    if (!questionOk(q)) continue;
    usedSentences.add(s);
    out.push({ type: "fill", question: q, answer: term, explanation: `From source: "${s}"` });
  }
  return out;
}

function makeTF(sentences, count, allEntities, usedSentences) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const q = s.replace(/[.!?]+$/, "");
    if (!questionOk(q)) continue;
    if (Math.random() > 0.4) {
      usedSentences.add(s);
      out.push({ type: "tf", question: q, answer: "True", explanation: "This statement appears directly in the source." });
    } else {
      const neg = negateSentence(s, allEntities);
      if (neg && questionOk(neg)) {
        usedSentences.add(s);
        out.push({ type: "tf", question: neg.replace(/[.!?]+$/, ""), answer: "False", explanation: `Correct: "${s}"` });
      }
    }
  }
  return out;
}

function makeMCQ(sentences, count, tfidfScores, allTerms, usedSentences) {
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
        out.push({ type: "mcq", question: defQ, choices, answer: choices.indexOf(def.subject), explanation: `From source: "${s}"` });
        continue;
      }
    }

    const wh = toWhQuestion(s);
    if (wh && questionOk(wh.question)) {
      const distractors = getDistractors(wh.answer, allTerms, wh.type, sTerms);
      if (distractors.length < 3) continue;
      const choices = shuffle([wh.answer, ...distractors.slice(0, 3)]);
      usedSentences.add(s);
      out.push({ type: "mcq", question: wh.question, choices, answer: choices.indexOf(wh.answer), explanation: `From source: "${s}"` });
      continue;
    }

    const answer = extractKeyTerm(s, tfidfScores);
    if (!answer) continue;
    const kwic = makeKwicBlank(s, answer);
    if (!kwic) continue;
    const kwicQ = `Choose the correct answer: "${kwic}"`;
    if (!questionOk(kwicQ)) continue;
    const type = detectEntityType(answer);
    const distractors = getDistractors(answer, allTerms, type, sTerms);
    if (distractors.length < 3) continue;
    const choices = shuffle([answer, ...distractors.slice(0, 3)]);
    usedSentences.add(s);
    out.push({ type: "mcq", question: kwicQ, choices, answer: choices.indexOf(answer), explanation: `From source: "${s}"` });
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
    out.push({ type: "fill", question: ce.question, answer: trimAnswer(ce.answer), explanation: `From source: "${s}"` });
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
    out.push({ type: "fill", question: seq.question, answer: trimAnswer(seq.answer), explanation: `From source: "${s}"` });
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
    out.push({ type: "mcq", question: cmp.question, choices, answer: choices.indexOf(cmp.answer), explanation: `From source: "${s}"` });
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

// ── Vocabulary-in-context questions ──────────────────────────────────────────
function makeVocabContext(sentences, count, tfidfScores, allTerms, usedSentences) {
  const out = [];
  const properLower = new Set(allTerms.flatMap(t => t.toLowerCase().split(/\s+/)));
  const vocabTerms = Object.entries(tfidfScores)
    .filter(([w]) => w.length > 3 && !STOP.has(w) && !properLower.has(w))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 40)
    .map(([w]) => w);

  if (vocabTerms.length < 4) return out;

  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (usedSentences.has(s)) continue;
    const sLower = s.toLowerCase();
    const matched = vocabTerms.find(w => sLower.includes(w));
    if (!matched) continue;
    const startIdx = sLower.indexOf(matched);
    const original = s.substring(startIdx, startIdx + matched.length);
    const kwic = makeKwicBlank(s, original);
    if (!kwic) continue;

    // Infer POS from context before the blank
    const contextBefore = kwic.split("___________")[0];
    const answerPos = inferPos(matched, contextBefore);

    // Prefer distractors of the same POS and similar length (±3 chars) for harder questions
    const lenMin = matched.length - 3, lenMax = matched.length + 3;
    const samePosTerms = vocabTerms.filter(t =>
      t !== matched &&
      inferPos(t, contextBefore) === answerPos &&
      t.length >= lenMin && t.length <= lenMax
    );
    const fallback = vocabTerms.filter(t => t !== matched && t.length >= lenMin && t.length <= lenMax);
    const pool = samePosTerms.length >= 3 ? samePosTerms : (fallback.length >= 3 ? fallback : vocabTerms.filter(t => t !== matched));
    const distractors = shuffle(pool).slice(0, 3);
    if (distractors.length < 3) continue;

    const answerDisplay = original.charAt(0).toUpperCase() + original.slice(1);
    const choiceList = [answerDisplay, ...distractors.map(d => d.charAt(0).toUpperCase() + d.slice(1))];
    const choices = shuffle(choiceList);
    usedSentences.add(s);
    out.push({ type: "mcq", question: `Which word best fits: "${kwic}"?`, choices, answer: choices.indexOf(answerDisplay), explanation: `From source: "${s}"` });
  }
  return out;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function generateNoAiQuiz(text, numQ, qType) {
  const sentences = extractSentences(text);
  if (sentences.length < 5) throw new Error("Not enough content to generate questions. Try adding more text.");

  const tfidfScores = tfidf(sentences);
  const allTerms = [...new Set(sentences.flatMap(s => extractProperNouns(s)))];
  const usedSentences = new Set();

  let qs;
  if (qType === "fill") qs = makeFill(sentences, numQ, tfidfScores, usedSentences);
  else if (qType === "tf") qs = makeTF(sentences, numQ, allTerms, usedSentences);
  else if (qType === "mcq") qs = makeMCQ(sentences, numQ, tfidfScores, allTerms, usedSentences);
  else {
    // Mixed: generate from all types, shuffle, take numQ
    const q = Math.ceil(numQ / 3);
    const pool = shuffle([
      ...makeMCQ(sentences, q, tfidfScores, allTerms, usedSentences),
      ...makeTF(sentences, q, allTerms, usedSentences),
      ...makeFill(sentences, q, tfidfScores, usedSentences),
      ...makeCauseEffect(sentences, q, usedSentences),
      ...makeSequence(sentences, q, usedSentences),
      ...makeComparison(sentences, q, allTerms, usedSentences),
      ...makeVocabContext(sentences, q, tfidfScores, allTerms, usedSentences),
    ]);
    qs = pool.slice(0, numQ);
  }
  if (!qs.length) throw new Error("Could not extract enough questions. Try a source with more complete sentences.");
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
