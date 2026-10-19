// Teacher Mode engine. Frontend-only, same "talks straight to Ollama,
// never touches the backend" shape as chartEngine.js/diagram.js --
// a lesson turn is just a JSON-schema chat completion, no heavy
// compute involved. Voice in/out is NOT duplicated here: the mic
// button already in Composer.jsx and the speaker button already on
// every assistant message in Message.jsx keep working for this mode
// exactly as they do for a normal chat turn.

export const LESSON_TYPES = [
  { id: "conversation", label: "Conversation practice" },
  { id: "correction", label: "Grammar correction" },
  { id: "quiz", label: "Quiz me" },
  { id: "story", label: "Tell me a story" },
  { id: "writing", label: "Writing practice" },
  { id: "pronunciation", label: "Pronunciation" },
  { id: "vocabulary", label: "Vocabulary builder" },
  { id: "roleplay", label: "Real-world roleplay" },
  { id: "debate", label: "Debate & discussion" },
  { id: "exam", label: "Exam prep (TOEFL/IELTS-style)" },
];

// Level + teaching-style pickers -- surfaced in TeacherToggle's popover.
export const LEVELS = [
  { id: "beginner", label: "Beginner (A1)" },
  { id: "elementary", label: "Elementary (A2)" },
  { id: "intermediate", label: "Intermediate (B1)" },
  { id: "upper-intermediate", label: "Upper-Int. (B2)" },
  { id: "advanced", label: "Advanced (C1)" },
];

export const TEACHER_STYLES = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "strict", label: "Strict" },
  { id: "socratic", label: "Socratic" },
];

const STYLE_PERSONAS = {
  professional: "a warm but professional, certified English-language instructor",
  friendly: "a warm, encouraging personal English teacher who keeps things relaxed and fun",
  strict: "a no-nonsense, exacting English instructor who holds the student to a high standard and never lets a mistake slide",
  socratic: "a Socratic English tutor who nudges the student toward noticing and fixing their own mistakes by asking guiding questions instead of just stating the fix",
};

// Lesson "phases" -- warm-up -> practice x3 -> challenge -> review,
// cycling automatically off the turn count, so a session feels like a
// structured class period instead of a flat, endless loop. "review" is
// a real checkpoint turn: the model pauses the lesson to recap progress.
const PHASE_CYCLE = ["warmup", "practice", "practice", "practice", "challenge", "review"];
export function computePhase(turns = 0) {
  return PHASE_CYCLE[turns % PHASE_CYCLE.length];
}
export const PHASE_LABELS = { warmup: "Warm-up", practice: "Practice", challenge: "Challenge", review: "Review" };

const LESSON_BRIEFS = {
  conversation:
    "Lead a natural, ongoing back-and-forth conversation like a real teacher chatting with a student. Pick natural, varied topics -- never reuse an opening or question you can see already used in the conversation history.",
  correction:
    "Focus on catching and clearly explaining grammar/word-choice mistakes, then invite the student to try the sentence again.",
  quiz:
    "Put exactly ONE multiple-choice question (4 options) in the \"quiz\" field as a single-item array, targeting the student's weak spots if any were given, otherwise general grammar/vocabulary for their level. Keep \"reply\" short -- a quick encouraging reaction to the previous answer (if any) plus the new question intro. The quiz field is MANDATORY on every quiz turn -- never leave it null or empty.",
  story:
    "Put a short story (4-8 sentences) at the student's level in \"story.text\", then 2-3 comprehension/vocabulary questions about it in \"story.questions\". Keep \"reply\" short -- just introduce the story.",
  writing:
    "If the student hasn't submitted a paragraph yet, ask them to write a short one on a topic. If they just submitted one, give 2-3 concrete fixes (not a full rewrite) and ask them to revise only those parts.",
  pronunciation:
    "Steer toward words that are commonly mispronounced. Ask the student to say a sentence back (they can use the mic button), and flag sounds in what they typed that are worth practicing out loud.",
  vocabulary:
    "Teach 1-2 new, level-appropriate words or phrases per turn: give a clear definition, an example sentence, and a natural collocation, then ask the student to use the word themselves in an original sentence. Check their attempt on the next turn before introducing the next word.",
  roleplay:
    "Run a real-world scenario roleplay (job interview, restaurant, hotel check-in, doctor's visit, customer service call, etc.) -- pick one and stay in character as the other person in the scene across turns unless the student asks to switch. Keep it realistic and natural, correcting mistakes without breaking character for more than a sentence.",
  debate:
    "Give the student a light discussion/debate topic and take the opposing (or a devil's-advocate) side, pushing back on their argument respectfully to make them defend and refine their reasoning in English. Focus corrections on persuasive language, linking words (however, therefore, on the other hand), and structuring an argument.",
  exam:
    "Run structured, exam-style practice in the vein of TOEFL/IELTS speaking or writing tasks -- a timed-feeling prompt (describe/compare/argue), then evaluate the student's answer the way an examiner would: task achievement, coherence, vocabulary range, and grammar accuracy, each briefly.",
};

// Fresh-topic pool per lesson type, so the same opening/question isn't
// reused turn after turn or session after session. This is a soft
// inspiration hint fed to the model, not a script -- the model still
// writes its own words.
const TOPIC_HINTS = {
  conversation: [
    "their weekend plans", "a movie or show they recently watched", "their favorite food and why",
    "a place they'd love to travel to", "what their morning routine looks like", "a hobby they enjoy",
    "the last thing that made them laugh", "their dream job", "a skill they want to learn",
    "their favorite season and why", "a memorable trip", "something they're looking forward to",
    "their favorite way to relax", "a book they've read or want to read", "what a perfect weekend looks like",
  ],
  story: [
    "a curious cat exploring a new city", "two friends lost in a forest", "a chef entering a big competition",
    "an astronaut's first day on a new planet", "a small shop with a big secret", "a rainy day that turns into an adventure",
    "a musician preparing for their first concert", "a traveler who misses their flight",
  ],
  writing: [
    "describe your ideal weekend", "write about a person who inspires you",
    "describe your hometown to someone who's never been there", "write about a time you learned something new",
    "describe your favorite meal",
  ],
  roleplay: [
    "a job interview for a role they'd actually want", "checking into a hotel with a booking problem",
    "ordering at a restaurant and asking about the menu", "a doctor's visit describing symptoms",
    "returning a faulty product to customer service", "asking for directions in an unfamiliar city",
  ],
  debate: [
    "whether social media does more good than harm", "whether remote work beats office work",
    "whether cities should ban cars from downtown areas", "whether university education is worth the cost",
    "whether AI will create more jobs than it takes",
  ],
  vocabulary: [
    "words for describing emotions precisely", "everyday idioms native speakers use casually",
    "business/professional vocabulary", "vocabulary for travel and directions",
    "words for giving opinions and agreeing/disagreeing politely",
  ],
};

function pickFreshTopic(lesson, recentTopics = []) {
  const pool = TOPIC_HINTS[lesson];
  if (!pool || !pool.length) return null;
  const fresh = pool.filter((t) => !recentTopics.includes(t));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

// Best-effort JSON extraction: some local models still wrap the object
// in stray prose even with format:"json" requested. Walk from the first
// "{" and track brace depth to pull out the first complete object.
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function callOllamaJson({ ollamaUrl, model, system, messages, temperature }) {
  const res = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature },
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${detail || "no detail"}`);
  }
  const json = await res.json();
  return (json?.message?.content || "").trim();
}

// One lesson turn -> { reply, corrected, correction_note, mistake_tags,
// quiz, story, topicUsed }. isStart=true means the teacher opens the
// lesson itself (no student message yet) -- used to auto-start a
// session the moment Teacher Mode (or a new lesson type) is switched on.
export async function runTeacherTurn({
  ollamaUrl,
  model = "qwen3:4b",
  lesson = "conversation",
  level = "intermediate",
  style = "professional",
  message,
  history = [],
  weakSpots = [],
  isStart = false,
  isContinue = false,
  isContinueStory = false,
  recentTopics = [],
  phase = "practice",
}) {
  const brief = LESSON_BRIEFS[lesson] || LESSON_BRIEFS.conversation;
  const schema = '{"reply": string, "corrected": string|null, "correction_note": string|null, "category": string|null, "severity": "minor"|"moderate"|"major"|null, "score": number|null, "next_focus": string|null, "mistake_tags": string[], "quiz": [{"question": string, "options": string[4], "answer_index": number, "explanation": string}]|null, "story": {"text": string, "questions": string[]}|null}';
  const topicHint = isStart ? pickFreshTopic(lesson, recentTopics) : null;

  const persona = STYLE_PERSONAS[style] || STYLE_PERSONAS.professional;
  const effectiveBrief =
    lesson === "story" && !isStart && !isContinueStory
      ? "The student is replying to your previous story's comprehension questions (or continuing that conversation). Discuss their answer naturally and react to it -- do NOT start a brand-new story on this turn unless they clearly ask for one."
      : brief;
  let system = `You are ${persona} running a live one-on-one lesson (student level: ${level}). ${effectiveBrief}`;

  // ALWAYS_CORRECT_MARKER -- correction is mandatory on any turn with
  // real typed input, independent of which phase the lesson is in.
  if (isStart) {
    system += ` This is the opening turn of a new lesson -- the student hasn't said anything yet, so there is nothing to correct yet. Greet them briefly and naturally like a real teacher starting a session, varying how you greet them so it never feels copy-pasted from a previous session, then get straight into the lesson.${topicHint ? ` A fresh angle you can draw on (put it in your own words, don't quote it): "${topicHint}".` : ""}`;
  } else if (isContinue) {
    system += ` The student just answered your last quiz question by clicking an option -- there is no typed text, so there is nothing to correct. Immediately continue with the NEXT multiple-choice question, clearly different from every question already asked earlier in this conversation, keeping the same encouraging quiz-host energy. Vary how you introduce it each time -- never reuse the same transition phrase.`;
  } else if (lesson === "story" && isContinueStory) {
    system += ` The student just finished the previous story and its questions -- there is no typed text, so there is nothing to correct. Immediately tell a brand-new short story (different characters and setting from any story already told in this conversation) with 2-3 fresh comprehension questions, keeping the same encouraging tone. Vary how you introduce it each time.`;
  } else {
    // CORRECTION_EXAMPLE_MARKER
    system += ` Act like a professional, certified language instructor giving precise, structured feedback -- not just a friendly nudge. Read the student's last message carefully for ANY grammar, vocabulary, word-choice, preposition, tense, word-order, register, or spelling mistake -- however small. This includes casual/texting-style slips, not just formal grammar: dropped words, missing spaces or apostrophes, missing capitalization, run-together words, and incomplete sentences all count as mistakes to fix, even in a relaxed conversation. Example: if the student writes "hi iam going", that is NOT acceptable casual style -- it is missing a subject/predicate and the contraction is malformed, so "corrected" should be something like "Hi, I'm going [somewhere]?" or "Hi, where are you going?" and "correction_note" should explain the fix (e.g. "iam" should be "I'm", and the sentence needs an object -- going where?). If you find any mistake like this, you MUST NOT leave "corrected" and "correction_note" both null: put the fully corrected sentence in "corrected", a one-sentence plain-English explanation of the fix in "correction_note", weave an acknowledgement of it into "reply" naturally so the student clearly notices it, and fill in "category" (one of: grammar, vocabulary, word-order, preposition, tense, register, fluency, spelling) and "severity" ("minor"/"moderate"/"major"). Only leave "corrected"/"correction_note"/"category"/"severity" null if the message was already fully correct AND complete. Don't stop the lesson to lecture -- keep it natural. Also score the student's last message for this stage of the lesson from 0-100 in "score" (accuracy + fluency combined) so progress can be tracked over time -- be honest and consistent, not just generous; a message with zero errors can still score high.`;
  }

  if (phase === "review" && !isStart && !isContinue) {
    system += ` This turn is ALSO a REVIEW CHECKPOINT -- after handling the correction above, use the rest of "reply" to give a short, honest progress recap: what the student is doing well, then the specific pattern(s) they keep slipping on (use the weak spots below if given), and put the single most important focus area for the next stretch of practice in "next_focus". End "reply" by smoothly handing back into the lesson with a fresh prompt so momentum isn't lost.`;
  }

  if (weakSpots.length) {
    system += ` The student has struggled before with: ${weakSpots.join(", ")} -- watch for these specifically and reinforce them.`;
  }
  if (lesson !== "quiz" && phase !== "review") {
    system += ` Never let "reply" sound like a dead end -- always close it with something that keeps the lesson going (a genuine follow-up question, an invitation to try the sentence again, or a prompt for their next paragraph/story answer), unless the student clearly says goodbye or asks to stop the lesson.`;
  }
  if (phase === "challenge" && lesson !== "quiz" && !isStart && !isContinue) {
    system += ` This turn is a CHALLENGE round -- push slightly above the student's usual level (richer vocabulary, a trickier structure, a more nuanced question) to stretch them, while keeping it achievable.`;
  }

  system += ` Reply with ONLY a single JSON object, no markdown fences, no commentary, matching this schema exactly: ${schema}. Leave "corrected"/"correction_note"/"category"/"severity"/"score"/"next_focus" null when not applicable, "quiz" null unless this is a quiz turn, "story" null unless this is a story turn. "mistake_tags" is 0-3 short lowercase tags (e.g. "past-tense", "articles", "prepositions", "word-order", "subject-verb-agreement") for any mistake just made -- empty array if there was nothing to fix or this is the opening turn.`;

  const userContent = isStart
    ? "(This is the start of the lesson -- I haven't said anything yet. Please begin.)"
    : isContinue
    ? "(I answered by clicking an option. Continue with the next question.)"
    : isContinueStory
    ? "(I finished the story and its questions. Please tell me a new one.)"
    : message;
  const chatMessages = [...history.slice(-8), { role: "user", content: userContent }];
  // Opening/quiz-continue turns have no correction to make, so they can
  // run warm and creative at 0.8. Every other turn has to reliably obey
  // the correction rule above, so it runs cooler -- 0.5 for the more
  // free-form lesson types, 0.35 for the more structured ones.
  const temperature = isStart || isContinue || isContinueStory ? 0.8 : lesson === "conversation" || lesson === "story" || lesson === "roleplay" || lesson === "debate" ? 0.5 : 0.35;

  const raw = await callOllamaJson({ ollamaUrl, model, system, messages: chatMessages, temperature });
  const cleaned = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = extractJsonObject(cleaned);
  }

  if (!parsed) {
    // Local models occasionally still wrap JSON in prose despite
    // format:"json" -- one stricter retry before giving up.
    try {
      const retryRaw = await callOllamaJson({
        ollamaUrl,
        model,
        system: system + " Your previous answer was not valid JSON. Reply again with ONLY the raw JSON object and nothing else.",
        messages: chatMessages,
        temperature: 0.3,
      });
      const retryCleaned = retryRaw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(retryCleaned) || extractJsonObject(retryCleaned);
    } catch (err) {
      console.warn("[teacher] JSON parse failed twice, falling back to plain reply:", err);
    }
  }

  if (!parsed) {
    parsed = { reply: raw || "Sorry, I lost my train of thought -- could you say that again?", corrected: null, correction_note: null, mistake_tags: [], quiz: null, story: null };
  }
  if (!Array.isArray(parsed.mistake_tags)) parsed.mistake_tags = [];
  const JUNK_TAGS = new Set(["none", "n/a", "na", "nothing", "no mistake", "no mistakes", "-", ""]);
  parsed.mistake_tags = parsed.mistake_tags
    .filter((t) => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !JUNK_TAGS.has(t));
  if (typeof parsed.score !== "number") parsed.score = null;
  parsed.category = parsed.category || null;
  parsed.severity = parsed.severity || null;
  parsed.next_focus = parsed.next_focus || null;
  if (lesson === "quiz" && (isStart || isContinue) && (!Array.isArray(parsed.quiz) || !parsed.quiz.length)) {
    parsed.quiz = [fallbackQuizQuestion()];
  }
  parsed.topicUsed = topicHint;
  parsed.phase = phase;
  return parsed;
}

// Mistake/progress memory -- localStorage only (mirrors storage.js's
// pattern), so it survives reloads without needing a backend endpoint.
const PROFILE_KEY = "lai-teacher-profile";

const JUNK_MISTAKE_TAGS = new Set(["none", "n/a", "na", "nothing", "no mistake", "no mistakes", "-", ""]);

// Drops any junk tag ("none"/"n/a"/etc.) that made it into a profile's
// mistake counts before the tag filter existed, so old sessions
// self-heal instead of showing a fake "none" weak spot forever.
function stripJunkMistakes(mistakes) {
  const clean = {};
  Object.entries(mistakes || {}).forEach(([tag, count]) => {
    const key = String(tag).trim().toLowerCase();
    if (key && !JUNK_MISTAKE_TAGS.has(key)) clean[key] = count;
  });
  return clean;
}

export function loadTeacherProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const profile = { mistakes: {}, turns: 0, updatedAt: null, recentTopics: [], scores: [], ...(stored || {}) };
    profile.mistakes = stripJunkMistakes(profile.mistakes);
    return profile;
  } catch {
    return { mistakes: {}, turns: 0, updatedAt: null, recentTopics: [], scores: [] };
  }
}

export function recordTeacherTurn(profile, mistakeTags = [], topicUsed = null, score = null) {
  const next = {
    mistakes: { ...(profile?.mistakes || {}) },
    turns: (profile?.turns || 0) + 1,
    updatedAt: new Date().toISOString(),
    recentTopics: [...(profile?.recentTopics || [])],
    scores: [...(profile?.scores || [])],
  };
  mistakeTags.forEach((tag) => {
    next.mistakes[tag] = (next.mistakes[tag] || 0) + 1;
  });
  if (topicUsed) {
    next.recentTopics = [topicUsed, ...next.recentTopics.filter((t) => t !== topicUsed)].slice(0, 6);
  }
  if (typeof score === "number" && !Number.isNaN(score)) {
    next.scores = [...next.scores, score].slice(-10);
  }
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[teacher] failed to save progress:", err);
  }
  return next;
}

export function topWeakSpots(profile, n = 3) {
  return Object.entries(profile?.mistakes || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag]) => tag);
}

export function getAverageScore(profile) {
  const scores = profile?.scores || [];
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Adaptive difficulty -- once there's enough signal (5+ recent scores),
// nudge the level up or down one step off the rolling average: mostly
// easy (>=88 avg) bumps up, mostly hard (<=45 avg) backs off one step.
const LEVEL_ORDER = ["beginner", "elementary", "intermediate", "upper-intermediate", "advanced"];
export function suggestLevel(currentLevel, profile) {
  const scores = profile?.scores || [];
  if (scores.length < 5) return currentLevel;
  const avg = getAverageScore(profile);
  const idx = LEVEL_ORDER.indexOf(currentLevel);
  if (idx === -1) return currentLevel;
  if (avg >= 88 && idx < LEVEL_ORDER.length - 1) return LEVEL_ORDER[idx + 1];
  if (avg <= 45 && idx > 0) return LEVEL_ORDER[idx - 1];
  return currentLevel;
}

export function resetTeacherProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {}
  return { mistakes: {}, turns: 0, updatedAt: null, recentTopics: [], scores: [] };
}

const FALLBACK_QUIZ_BANK = [
  { question: "Choose the correct sentence:", options: ["She don't like coffee.", "She doesn't like coffee.", "She not like coffee.", "She isn't liking coffee."], answer_index: 1, explanation: "Third-person singular present tense needs \"doesn't\", not \"don't\"." },
  { question: "Pick the correctly ordered sentence:", options: ["I yesterday went to the store.", "Yesterday I went to the store.", "I went yesterday to the store.", "Went I yesterday to the store."], answer_index: 1, explanation: "Time expressions like \"yesterday\" usually sit at the start or end of a sentence, not mid-clause." },
  { question: "Which sentence uses the correct article?", options: ["I saw a elephant.", "I saw an elephant.", "I saw the a elephant.", "I saw elephant."], answer_index: 1, explanation: "\"An\" is used before words that start with a vowel sound." },
  { question: "Which sentence is correct?", options: ["He have two brothers.", "He has two brothers.", "He having two brothers.", "He has two brother."], answer_index: 1, explanation: "Third-person singular subjects (he/she/it) take \"has\", not \"have\"." },
];
function fallbackQuizQuestion() {
  return FALLBACK_QUIZ_BANK[Math.floor(Math.random() * FALLBACK_QUIZ_BANK.length)];
}
