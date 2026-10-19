// Rotating, time-of-day-aware welcome quotes for the empty-state screen.

const MORNING = [
  "Good morning. Let's make today count.",
  "Rise and shine — what are we building?",
  "Fresh coffee, fresh ideas. Morning!",
  "A new morning, a blank page. Go for it.",
  "Early start, clear mind.",
];

const AFTERNOON = [
  "Good afternoon. What's next on your mind?",
  "Midday check-in — how can I help?",
  "Afternoon focus mode: activated.",
  "Let's keep the momentum going.",
  "Halfway through the day — let's make it count.",
];

const EVENING = [
  "Good evening. Winding down or just getting started?",
  "Evening thoughts deserve good answers.",
  "The day's not over — let's finish strong.",
  "Golden hour, good questions.",
];

const NIGHT = [
  "Burning the midnight oil? I'm here.",
  "Quiet hours, clear thoughts.",
  "Late night, good company.",
  "Still up? Let's make it worth it.",
  "The night is young. What are you working on?",
];

const MOTIVATION = [
  "Small steps, every day.",
  "Done is better than perfect.",
  "Your local AI, always ready.",
  "Think it. Type it. Build it.",
  "Every great idea starts with a single message.",
  "One question away from clarity.",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Returns a fresh greeting/quote based on the current time of day,
 * occasionally mixed with a general motivational line. Call this
 * each time you want a new quote (e.g. on every app load).
 */
export function getGreeting(date = new Date()) {
  const hour = date.getHours();
  let pool;

  if (hour >= 5 && hour < 12) pool = MORNING;
  else if (hour >= 12 && hour < 17) pool = AFTERNOON;
  else if (hour >= 17 && hour < 22) pool = EVENING;
  else pool = NIGHT;

  if (Math.random() < 0.35) return pick(MOTIVATION);
  return pick(pool);
}
