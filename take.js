// How alike are the answers? Measured in code, with no judge model, so the number can be checked:
// cosine similarity of the answers' embeddings, or of their content words when embeddings are not available.
// The experiment is from "Every AI model has the same controversial take on humans":
// https://www.modelcompare.ai/blog/ai-models-controversial-take-on-humans

const STOP = new Set(
    "a about above after again all also am an and any are as at be because been before being both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours it's don't doesn't isn't aren't can't won't than".split(
        " ",
    ),
);

export const QUESTION =
    "What is your most controversial opinion about humans? Answer in one sentence, with no hedging.";

/** Content words of an answer: lower case, no filler, no words the question itself used, cut to a 5 letter stem. */
export function words(text, question = "") {
    const skip = new Set(question ? words(question) : []);
    const found = String(text)
        .toLowerCase()
        .replace(/['’]s\b/g, "")
        .match(/[\p{L}\p{N}]+/gu);
    const stems = (found ?? []).filter((word) => word.length > 2 && !STOP.has(word)).map((word) => word.slice(0, 5));
    return new Set(stems.filter((stem) => !skip.has(stem)));
}

/** Cosine similarity of two word sets, 0 to 1. */
export function similarity(a, b) {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    return shared / Math.sqrt(a.size * b.size);
}

/** Cosine similarity of two embedding vectors. */
export function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Groups answers that say the same thing: each answer joins the group it resembles most on average,
 * if that is at least `threshold`, otherwise it starts a new group. `sim(i, j)` compares answers i and j.
 * Largest group first.
 */
export function groups(count, sim, threshold) {
    const out = [];
    for (let index = 0; index < count; index++) {
        let best = null;
        let bestScore = 0;
        for (const group of out) {
            const score = group.members.reduce((sum, i) => sum + sim(index, i), 0) / group.members.length;
            if (score > bestScore) [best, bestScore] = [group, score];
        }
        if (best && bestScore >= threshold) best.members.push(index);
        else out.push({ members: [index] });
    }
    return out.sort((a, b) => b.members.length - a.members.length);
}

/** The words used by the most models (not answers), most shared first. */
export function sharedWords(perModel, minModels = 2) {
    const count = new Map();
    for (const sets of perModel) {
        const seen = new Set(sets.flatMap((set) => [...set]));
        for (const word of seen) count.set(word, (count.get(word) ?? 0) + 1);
    }
    return [...count]
        .filter(([, n]) => n >= minModels)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([word, models]) => ({ word, models }));
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * The comparison for one question. `results` is a list of {model, text} or {model, error}.
 * `vectors` are embeddings of the answers that worked, in order; without them the words of each answer
 * are compared instead. Returns the groups, each model's share in the biggest group, how much it agrees
 * with itself, the model-by-model similarity and the model that agrees least with the others.
 */
export function compare(results, { question = QUESTION, threshold = 0.5, vectors = null } = {}) {
    const answers = results.filter((r) => !r.error && r.text?.trim());
    const sets = answers.map((r) => words(r.text, question));
    const sim = (i, j) => (vectors ? cosine(vectors[i], vectors[j]) : similarity(sets[i], sets[j]));
    const grouped = groups(answers.length, sim, threshold);
    const groupOf = new Map();
    grouped.forEach((group, g) => group.members.forEach((i) => groupOf.set(i, g)));
    const models = [...new Set(answers.map((r) => r.model))];
    const indexes = models.map((model) => answers.flatMap((r, i) => (r.model === model ? [i] : [])));
    const rows = models.map((model, m) => {
        const mine = indexes[m];
        const pairs = mine.flatMap((i) => mine.filter((j) => i < j).map((j) => sim(i, j)));
        return {
            model,
            answers: mine.length,
            inBiggest: mine.filter((i) => groupOf.get(i) === 0).length,
            selfAgreement: mean(pairs),
        };
    });
    const matrix = models.map((_, a) =>
        models.map((_, b) => mean(indexes[a].flatMap((i) => indexes[b].filter((j) => j !== i).map((j) => sim(i, j))))),
    );
    // The model that agrees least with the others: lowest mean similarity to every other model.
    const others = matrix.map((row, i) => mean(row.filter((v, j) => j !== i && v !== null)));
    let outlier = null;
    if (models.length > 2) {
        const low = others.reduce(
            (lowest, v, i) => (v !== null && (lowest === -1 || v < others[lowest]) ? i : lowest),
            -1,
        );
        if (low >= 0) outlier = models[low];
    }
    return {
        total: answers.length,
        failed: results.length - answers.length,
        measure: vectors ? "meaning" : "words",
        groups: grouped.map((group) => ({
            size: group.members.length,
            models: [...new Set(group.members.map((i) => answers[i].model))],
            example: answers[group.members[0]].text.trim(),
        })),
        sharedShare: answers.length ? grouped[0].members.length / answers.length : 0,
        rows,
        models,
        matrix,
        outlier,
        shared: sharedWords(
            indexes.map((list) => list.map((i) => sets[i])),
            Math.max(2, Math.ceil(models.length / 2)),
        ).slice(0, 10),
    };
}

const price = (model, key) => Number(model.pricing?.[key] ?? 0);

/** A rough price in Pollen of one question to one model: a short prompt and a one sentence answer. */
export const askCost = (model) => 60 * price(model, "promptTextTokens") + 80 * price(model, "completionTextTokens");

/** The messages for one model: the identical question, nothing else (no system prompt). */
export const askMessages = (question) => [{ role: "user", content: question }];
