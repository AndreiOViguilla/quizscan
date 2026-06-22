import nlp from "compromise";

// ── Text cleaning ────────────────────────────────────────────────────────────

function cleanText(raw) {
  return raw
    .replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/\s+/g, " ").trim();
}

// ── Sentence extraction with importance scoring ──────────────────────────────

function scoreSentence(s, idx, total) {
  let score = 0;
  // Position: first and last sentences of doc are more important
  if (idx < total * 0.2) score += 2;
  if (idx > total * 0.8) score += 1;
  // Contains defining language
  if (/\b(is|are|was|were|defined as|refers to|known as|called)\b/i.test(s)) score += 3;
  // Contains numbers/dates (factual)
  if (/\b\d{4}\b|\b\d+(\.\d+)?(%|million|billion|km|kg)\b/i.test(s)) score += 2;
  // Contains proper nouns (named entities likely)
  if (/\b[A-Z][a-z]{2,}/.test(s)) score += 1;
  // Penalise very short or very long
  const words = s.split(" ").length;
  if (words < 8 || words > 45) score -= 2;
  return score;
}

function extractSentences(text) {
  const raw = cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.split(" ").length >= 6);

  return raw
    .map((s, i) => ({ s, score: scoreSentence(s, i, raw.length) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}

// ── TF-IDF key term extraction ───────────────────────────────────────────────

const STOP = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","need","dare","ought","used","to","of","in","on","at","by","for","with","about","against","between","into","through","during","before","after","above","below","from","up","down","out","off","over","under","again","then","once","and","but","or","nor","so","yet","both","either","neither","not","no","only","own","same","than","too","very","just","as","if","while","because","since","although","though","unless","until","when","where","who","which","that","this","these","those","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","what","how","all","each","every","some","any","few","more","most","other","such","into","also","its"]);

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
  tf.forEach((freq, i) => {
    const len = Object.values(freq).reduce((a, b) => a + b, 1);
    Object.entries(freq).forEach(([w, c]) => {
      const tfidfScore = (c / len) * Math.log(docCount / (df[w] + 1));
      scores[w] = (scores[w] || 0) + tfidfScore;
    });
  });
  return scores;
}

// ── NLP-powered key term extraction (compromise) ─────────────────────────────

function extractTermsFromSentence(sentence, tfidfScores) {
  const doc = nlp(sentence);

  // 1. Named entities first (people, places, organizations)
  const people = doc.people().out("array");
  const places = doc.places().out("array");
  const orgs = doc.organizations().out("array");
  const entities = [...people, ...places, ...orgs].filter(Boolean);
  if (entities.length) return entities[0];

  // 2. Noun phrases
  const nounPhrases = doc.nouns().out("array").filter(n => n.length > 2 && !STOP.has(n.toLowerCase()));
  if (nounPhrases.length) {
    // pick highest TF-IDF scoring noun phrase
    const scored = nounPhrases.map(n => ({ n, score: tfidfScores[n.toLowerCase()] || 0 })).sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].n;
    return nounPhrases[0];
  }

  // 3. Numbers/dates as fallback
  const nums = sentence.match(/\b\d[\d,.]*(?:\s*(?:million|billion|thousand|percent|%|km|kg))?\b/g);
  if (nums) return nums[0];

  return null;
}

// ── Wh-question generation ───────────────────────────────────────────────────

function toWhQuestion(sentence) {
  const doc = nlp(sentence);

  // Who — subject is a person
  const people = doc.people().out("array");
  if (people.length) {
    const q = sentence.replace(people[0], "Who");
    if (q !== sentence) return { question: q.replace(/^Who\b/, "Who") + "?", answer: people[0] };
  }

  // When — contains a date/year
  const dates = doc.dates().out("array");
  if (dates.length) {
    const q = sentence.replace(dates[0], "when");
    return { question: "When " + q.charAt(0).toLowerCase() + q.slice(1).replace(/[.!?]$/, "") + "?", answer: dates[0] };
  }

  // Where — contains a place
  const places = doc.places().out("array");
  if (places.length) {
    const q = sentence.replace(places[0], "where");
    return { question: "Where " + q.charAt(0).toLowerCase() + q.slice(1).replace(/[.!?]$/, "") + "?", answer: places[0] };
  }

  // How many — contains a number
  const numMatch = sentence.match(/\b(\d[\d,]*)\b/);
  if (numMatch) {
    const q = sentence.replace(numMatch[0], "how many");
    return { question: q.charAt(0).toUpperCase() + q.slice(1).replace(/[.!?]$/, "") + "?", answer: numMatch[0] };
  }

  return null;
}

// ── Distractor generation ────────────────────────────────────────────────────

function getDistractors(answer, allTerms, sentence) {
  const doc = nlp(sentence);
  const answerIsNum = /^\d/.test(answer);
  const answerIsYear = /^\d{4}$/.test(answer);

  if (answerIsYear) {
    const year = parseInt(answer);
    return [year - 5, year + 5, year - 10, year + 10]
      .filter(y => y !== year && y > 1000 && y < 2100)
      .slice(0, 3).map(String);
  }

  if (answerIsNum) {
    const n = parseFloat(answer.replace(/,/g, ""));
    const deltas = [0.5, 2, 3].map(m => Math.round(n * m * 10) / 10);
    return deltas.filter(d => d !== n).slice(0, 3).map(String);
  }

  // Same-category terms (people → other people, places → other places)
  const answerDoc = nlp(answer);
  let sameCategory = [];
  if (answerDoc.people().length) sameCategory = allTerms.filter(t => nlp(t).people().length && t !== answer);
  else if (answerDoc.places().length) sameCategory = allTerms.filter(t => nlp(t).places().length && t !== answer);
  else if (answerDoc.organizations().length) sameCategory = allTerms.filter(t => nlp(t).organizations().length && t !== answer);

  if (sameCategory.length >= 3) return shuffle(sameCategory).slice(0, 3);

  // Fallback: other noun-like terms from text
  return shuffle(allTerms.filter(t => t !== answer && t.length > 2)).slice(0, 3);
}

// ── Question builders ────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function negateSentence(sentence) {
  const numMatch = sentence.match(/\b(\d+)\b/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    const delta = Math.max(1, Math.ceil(n * 0.4));
    const fake = Math.random() > 0.5 ? n + delta : Math.max(1, n - delta);
    if (fake !== n) return sentence.replace(numMatch[0], String(fake));
  }
  const verbMatch = sentence.match(/\b(is|are|was|were)\b/i);
  if (verbMatch) return sentence.replace(verbMatch[0], `${verbMatch[0]} not`);
  return null;
}

function makeFill(sentences, count, tfidfScores) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;

    // Try wh-question first
    const wh = toWhQuestion(s);
    if (wh) {
      out.push({ type: "fill", question: wh.question, answer: wh.answer, explanation: `From source: "${s}"` });
      continue;
    }

    // Fall back to blank
    const term = extractTermsFromSentence(s, tfidfScores);
    if (!term) continue;
    const q = s.replace(term, "___________");
    if (q === s) continue;
    out.push({ type: "fill", question: `Fill in the blank: "${q}"`, answer: term, explanation: `From source: "${s}"` });
  }
  return out;
}

function makeTF(sentences, count) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;
    if (Math.random() > 0.4) {
      out.push({ type: "tf", question: s.replace(/[.!?]+$/, ""), answer: "True", explanation: "This statement is directly from the source." });
    } else {
      const neg = negateSentence(s);
      if (neg) out.push({ type: "tf", question: neg.replace(/[.!?]+$/, ""), answer: "False", explanation: `Correct statement: "${s}"` });
    }
  }
  return out;
}

function makeMCQ(sentences, count, tfidfScores, allTerms) {
  const out = [];
  for (const s of shuffle(sentences)) {
    if (out.length >= count) break;

    const answer = extractTermsFromSentence(s, tfidfScores);
    if (!answer) continue;
    const q = s.replace(answer, "___________");
    if (q === s) continue;

    const distractors = getDistractors(answer, allTerms, s);
    if (distractors.length < 3) continue;

    const choices = shuffle([answer, ...distractors.slice(0, 3)]);
    const answerIdx = choices.indexOf(answer);
    out.push({
      type: "mcq",
      question: `Choose the correct answer: "${q}"`,
      choices,
      answer: answerIdx,
      explanation: `From source: "${s}"`,
    });
  }
  return out;
}

// ── Main export ──────────────────────────────────────────────────────────────

export function generateNoAiQuiz(text, numQ, qType) {
  const sentences = extractSentences(text);
  if (sentences.length < 5) throw new Error("Not enough content to generate questions. Try adding more text.");

  const tfidfScores = tfidf(sentences);
  const allTerms = [...new Set(
    sentences.flatMap(s => {
      const doc = nlp(s);
      return [
        ...doc.people().out("array"),
        ...doc.places().out("array"),
        ...doc.organizations().out("array"),
        ...doc.nouns().out("array").filter(n => n.length > 3 && !STOP.has(n.toLowerCase())),
      ];
    })
  )];

  let qs;
  if (qType === "fill") qs = makeFill(sentences, numQ, tfidfScores);
  else if (qType === "tf") qs = makeTF(sentences, numQ);
  else if (qType === "mcq") qs = makeMCQ(sentences, numQ, tfidfScores, allTerms);
  else {
    const third = Math.floor(numQ / 3);
    const rest = numQ - third * 2;
    qs = shuffle([
      ...makeMCQ(sentences, third, tfidfScores, allTerms),
      ...makeTF(sentences, third),
      ...makeFill(sentences, rest, tfidfScores),
    ]);
  }

  if (!qs.length) throw new Error("Could not extract enough questions. Try a source with more complete sentences.");
  return qs;
}

// ── PDF text extraction (PDF.js) ─────────────────────────────────────────────

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
