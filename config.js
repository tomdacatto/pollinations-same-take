// What a visitor's key may spend and for how long. Pollen is per visitor.
// Six cheap models asked three times each cost a few hundredths of a Pollen.
export const BUDGET = 0.5;
export const EXPIRY_DAYS = 1;

// How many questions are in flight at once.
export const CONCURRENCY = 4;

// Models ticked at the start, when the live list has them: one per lab.
export const DEFAULT_MODELS = [
    "google/gemini-3.5-flash-lite",
    "openai/gpt-5.4-nano",
    "deepseek/deepseek-v4.1-flash",
    "qwen/qwen3.7-flash",
    "qwen/qwen3.8-flash",
    "z-ai/glm-5.3-flash",
    "nex-agi/nex-n2.5-mini",
];

// The model that turns each answer into numbers, so answers are compared by meaning.
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

// Questions to start from; the first is the post's.
export const QUESTIONS = [
    "What is your most controversial opinion about humans? Answer in one sentence, with no hedging.",
    "What is the one thing most people get wrong about money? Answer in one sentence.",
    "Name the most overrated invention in history, and why, in one sentence.",
    "If you could delete one word from the English language, which would it be? Answer in one sentence.",
];
