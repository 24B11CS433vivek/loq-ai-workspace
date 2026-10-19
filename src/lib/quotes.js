const BUCKETS = {
  morning: [
    "Good morning — what should we build today?",
    "Coffee's brewing, so is your next idea.",
    "Early start, clear head. Let's go.",
  ],
  afternoon: [
    "Midday momentum — what's on your mind?",
    "Halfway through the day. Let's keep it moving.",
    "Your ideas, your hardware, your privacy.",
  ],
  evening: [
    "Winding down? Let's wrap up something good.",
    "Evening focus mode. What are we solving?",
    "Thinking locally, reasoning deeply.",
  ],
  night: [
    "Burning the midnight oil — I'm here.",
    "Late night, clear mind. What's next?",
    "Ask anything. Everything stays on this machine.",
  ],
};

function getBucket(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export function randomQuote() {
  const list = BUCKETS[getBucket()];
  return list[Math.floor(Math.random() * list.length)];
}
