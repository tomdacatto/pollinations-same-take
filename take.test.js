import assert from "node:assert/strict";
import test from "node:test";
import { askCost, askMessages, compare, cosine, groups, QUESTION, sharedWords, similarity, words } from "./take.js";

// Answers quoted from the ModelCompare post that the experiment is taken from.
const BELONGING = [
    "Humans are more loyal to belonging than to truth.",
    "Humans care more about belonging than about being right.",
    "Humans would rather be wrong together than right alone.",
];
const OTHER =
    "Humans care more about being the hero of their own story than about discovering whether that story is true.";

test("words drops filler, the question's own words and cuts to a stem", () => {
    const set = words("Humans are more loyal to belonging than to truth.", QUESTION);
    assert.deepEqual([...set].sort(), ["belon", "loyal", "truth"]);
    assert.ok(words("The loyalty of the loyal").has("loyal"));
});

test("similarity of word sets is cosine, zero for an empty answer", () => {
    assert.equal(similarity(new Set(["a", "b"]), new Set(["a", "b"])), 1);
    assert.equal(similarity(new Set(["a", "b"]), new Set(["c"])), 0);
    assert.equal(similarity(new Set(), new Set(["a"])), 0);
    assert.ok(Math.abs(similarity(new Set(["a", "b"]), new Set(["a", "c"])) - 0.5) < 1e-9);
});

test("cosine of vectors", () => {
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.ok(Math.abs(cosine([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9);
    assert.equal(cosine([0, 0], [1, 0]), 0);
});

test("answers close enough join a group, a far one starts its own, biggest group first", () => {
    // Four answers on a line: 0, 0.1 and 0.2 are close, 5 is far.
    const at = [0, 0.1, 5, 0.2];
    const grouped = groups(at.length, (i, j) => 1 - Math.min(1, Math.abs(at[i] - at[j])), 0.6);
    assert.deepEqual(grouped[0].members, [0, 1, 3]);
    assert.deepEqual(grouped[1].members, [2]);
});

test("compare with vectors reports the biggest group, per model agreement and the outlier", () => {
    const results = [
        { model: "a", text: BELONGING[0] },
        { model: "a", text: BELONGING[1] },
        { model: "b", text: BELONGING[2] },
        { model: "b", text: "People pick belonging over truth." },
        { model: "c", text: "Bananas are the best fruit." },
        { model: "c", error: "refused" },
    ];
    const vectors = [
        [1, 0.1, 0],
        [0.9, 0.2, 0],
        [1, 0, 0.1],
        [0.95, 0.1, 0.05],
        [0, 0, 1],
    ];
    const summary = compare(results, { threshold: 0.8, vectors });
    assert.equal(summary.measure, "meaning");
    assert.equal(summary.total, 5);
    assert.equal(summary.failed, 1);
    assert.equal(summary.groups[0].size, 4);
    assert.deepEqual(summary.groups[0].models, ["a", "b"]);
    assert.equal(summary.sharedShare, 4 / 5);
    assert.equal(summary.outlier, "c");
    const rowA = summary.rows.find((r) => r.model === "a");
    assert.equal(rowA.inBiggest, 2);
    assert.ok(rowA.selfAgreement > 0.95);
    assert.equal(summary.rows.find((r) => r.model === "c").selfAgreement, null);
    assert.ok(summary.matrix[0][1] > summary.matrix[0][2], "a is closer to b than to c");
});

test("compare falls back to the words when there are no vectors", () => {
    const results = [
        { model: "a", text: BELONGING[0] },
        { model: "b", text: "Humans care more about belonging than about truth." },
        { model: "c", text: OTHER },
    ];
    const summary = compare(results, { threshold: 0.3 });
    assert.equal(summary.measure, "words");
    assert.deepEqual(summary.groups[0].models, ["a", "b"]);
    assert.ok(summary.shared.some((w) => w.word === "belon"));
});

test("a model alone has no outlier and an empty run does not throw", () => {
    assert.equal(compare([{ model: "a", text: "One thing." }]).outlier, null);
    const empty = compare([{ model: "a", error: "x" }]);
    assert.equal(empty.total, 0);
    assert.equal(empty.sharedShare, 0);
});

test("sharedWords counts models, not repeats", () => {
    const one = [new Set(["x"]), new Set(["x"]), new Set(["y"])];
    const two = [new Set(["x", "z"])];
    assert.deepEqual(sharedWords([one, two], 2), [{ word: "x", models: 2 }]);
});

test("each model gets the question alone and a price comes from its per token prices", () => {
    assert.deepEqual(askMessages("Q?"), [{ role: "user", content: "Q?" }]);
    assert.equal(askCost({ pricing: { promptTextTokens: 1, completionTextTokens: 2 } }), 60 + 160);
});
