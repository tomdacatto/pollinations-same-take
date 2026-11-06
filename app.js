import { CONCURRENCY, DEFAULT_MODELS, EMBEDDING_MODEL, QUESTIONS } from "./config.js";
import { loadModels } from "./models.js";
import { chat, clearSession, completeSignIn, embed, getSession, startSignIn } from "./pollen.js";
import { askCost, askMessages, compare } from "./take.js";
import { $, checked, el, money, notice, pool, renderModels, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";

const state = { models: [], results: [], vectors: null, controller: null };
const percent = (value) => `${Math.round(value * 100)}%`;

function estimate() {
    const names = checked($("#models"));
    const times = Number($("#repeats").value);
    const cost = names.reduce((sum, name) => {
        const model = state.models.find((m) => m.name === name);
        return sum + (model ? askCost(model) * times : 0);
    }, 0);
    $("#estimate").textContent = names.length
        ? `${names.length * times} answers: about ${money(cost)} Pollen (a rough estimate).`
        : "Pick at least one model.";
}

function renderMatrix(summary) {
    const table = $("#matrix");
    table.replaceChildren();
    const head = el("tr");
    head.append(el("th"));
    for (const model of summary.models) head.append(el("th", "", model.split("/").pop()));
    table.append(head);
    summary.models.forEach((model, i) => {
        const tr = el("tr");
        tr.append(el("th", "", model.split("/").pop()));
        summary.matrix[i].forEach((value) => {
            const td = el("td", "heat", value === null ? "" : value.toFixed(2));
            if (value !== null) td.style.background = `rgba(125, 211, 252, ${Math.min(0.9, value * 1.4).toFixed(2)})`;
            if (value !== null && value > 0.5) td.style.color = "#0f1117";
            tr.append(td);
        });
        table.append(tr);
    });
}

function renderVerdict() {
    const threshold = Number($("#threshold").value);
    const question = $("#question").value.trim();
    const vectors = state.vectors?.length === state.results.filter((r) => !r.error).length ? state.vectors : null;
    const summary = compare(state.results, { question, threshold, vectors });
    $("#verdict").hidden = !summary.total;
    if (!summary.total) return;
    const top = summary.groups[0];
    $("#headline").textContent =
        `${Math.round(summary.sharedShare * summary.total)} of ${summary.total} answers are close in meaning (${percent(summary.sharedShare)})`;
    $("#detail").textContent =
        `The biggest group has ${top.size} answers from ${top.models.length} of ${summary.models.length} models.` +
        (summary.outlier ? ` ${summary.outlier} agrees least with the others.` : "") +
        (summary.measure === "words"
            ? " Compared by the words they use, because the embeddings were not available."
            : "") +
        (summary.failed
            ? ` ${summary.failed} request${summary.failed > 1 ? "s" : ""} failed and are not counted.`
            : "");
    const shared = $("#shared");
    shared.replaceChildren();
    for (const { word, models } of summary.shared)
        shared.append(el("span", "chip", `${word}… used by ${models} model${models > 1 ? "s" : ""}`));
    const groupsBox = $("#groups");
    groupsBox.replaceChildren();
    summary.groups.forEach((group, i) => {
        const box = el("div", `group${i === 0 ? " main" : ""}`);
        box.append(
            el("strong", "", i === 0 ? `Biggest group · ${group.size}` : `Group ${i + 1} · ${group.size}`),
            el("div", "quote", `“${group.example}”`),
            el("div", "fine", group.models.join(", ")),
        );
        groupsBox.append(box);
    });
    renderMatrix(summary);
    const table = $("#table");
    table.replaceChildren();
    const head = el("tr");
    for (const title of ["Model", "Answers", "In the biggest group", "Agrees with itself"])
        head.append(el("th", "", title));
    table.append(head);
    for (const row of summary.rows) {
        const tr = el("tr");
        const self = row.selfAgreement === null ? "one answer" : row.selfAgreement.toFixed(2);
        for (const cell of [row.model, row.answers, `${row.inBiggest} of ${row.answers}`, self])
            tr.append(el("td", "", String(cell)));
        table.append(tr);
    }
}

function renderAnswers() {
    const box = $("#answers");
    box.replaceChildren();
    for (const model of [...new Set(state.results.map((r) => r.model))]) {
        const card = el("article", "pic");
        card.append(el("h3", "", model));
        for (const result of state.results.filter((r) => r.model === model))
            card.append(
                result.error ? el("div", "seek v-error", result.error) : el("div", "seek", `“${result.text.trim()}”`),
            );
        box.append(card);
    }
}

async function run() {
    if (!getSession()) return startSignIn();
    const names = checked($("#models"));
    const question = $("#question").value.trim();
    if (!names.length || !question) return notice("Write a question and pick at least one model.", "error");
    const times = Number($("#repeats").value);
    const jobs = names.flatMap((model) => Array.from({ length: times }, () => model));
    state.results = [];
    state.vectors = null;
    notice(null);
    state.controller = new AbortController();
    const { signal } = state.controller;
    $("#run").disabled = true;
    $("#stop").hidden = false;
    const progress = () => ($("#progress").textContent = `${state.results.length} of ${jobs.length} answers in`);
    progress();
    await pool(
        jobs,
        CONCURRENCY,
        async (model) => {
            try {
                state.results.push({
                    model,
                    text: await chat(model, askMessages(question), { signal, seed: Math.floor(Math.random() * 1e9) }),
                });
            } catch (error) {
                if (signal.aborted) return;
                state.results.push({ model, error: error.message });
                if (/sign-in expired|Out of Pollen/.test(error.message)) state.controller.abort();
            }
            progress();
            renderAnswers();
        },
        signal,
    );
    // Once the answers are in, embed them to compare their meaning; the words are the fallback.
    // Grouping goes through the answers in order, so fix the order: by model, not by arrival.
    state.results.sort((a, b) => a.model.localeCompare(b.model));
    const worked = state.results.filter((r) => !r.error);
    if (worked.length > 1 && !signal.aborted) {
        $("#progress").textContent = "Comparing the answers...";
        try {
            state.vectors = await embed(
                EMBEDDING_MODEL,
                worked.map((r) => r.text.trim()),
                { signal },
            );
        } catch (error) {
            if (!signal.aborted) notice(`Compared by words instead: ${error.message}`, "error");
        }
    }
    renderVerdict();
    $("#progress").textContent = `${state.results.length} answers in`;
    $("#run").disabled = false;
    $("#stop").hidden = true;
    const firstError = state.results.find((r) => r.error)?.error;
    if (firstError) notice(`Some answers failed. The first error: ${firstError}`, "error");
    renderSession();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = run;
$("#stop").onclick = () => state.controller?.abort();
$("#repeats").onchange = estimate;
$("#threshold").onchange = renderVerdict;
$("#question").value = QUESTIONS[0];
for (const q of QUESTIONS)
    $("#presets").append(
        Object.assign(el("button", "button small", q.split(/[?.]/)[0].slice(0, 46)), {
            type: "button",
            onclick: () => {
                $("#question").value = q;
            },
        }),
    );

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        renderModels($("#models"), models, DEFAULT_MODELS, estimate);
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
