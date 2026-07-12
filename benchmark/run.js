// Batch benchmark runner: runs every benchmark question through one or more
// RAG engines and writes raw results + a per-mode summary for the paper.
//
// Usage:
//   node benchmark/run.js                          # all questions, all 3 modes
//   node benchmark/run.js --modes dr-rag           # single mode
//   node benchmark/run.js --modes basic,corrective --limit 5
//   node benchmark/run.js --ablations all          # 4 dr-rag ablations, no plain modes
//   node benchmark/run.js --modes dr-rag --ablations no-cfs,no-grounding
//   node benchmark/run.js --out results/pilot.json
//
// Results are appended to the DB by the backend as usual; this script also
// saves a local JSON file with everything needed for the paper tables.
const { writeFileSync, mkdirSync } = require("fs");
const path = require("path");
const { login, api } = require("./lib");

const ALL_MODES = ["basic", "corrective", "dr-rag", "agentic"];
const ALL_ABLATIONS = ["no-stage2", "no-metadata", "no-grounding", "no-cfs"];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { modes: null, ablations: [], limit: Infinity, out: null };

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--modes") opts.modes = args[++i].split(",");
    else if (args[i] === "--ablations") {
      const value = args[++i];
      opts.ablations = value === "all" ? ALL_ABLATIONS : value.split(",");
    } else if (args[i] === "--limit") opts.limit = Number(args[++i]);
    else if (args[i] === "--out") opts.out = args[++i];
  }

  // Default: all plain modes when neither flag given; ablations-only runs skip
  // the plain modes unless --modes is also passed.
  if (!opts.modes) opts.modes = opts.ablations.length ? [] : ALL_MODES;

  for (const m of opts.modes) {
    if (!ALL_MODES.includes(m)) {
      console.error(`Unknown mode "${m}". Valid: ${ALL_MODES.join(", ")}`);
      process.exit(1);
    }
  }
  for (const a of opts.ablations) {
    if (!ALL_ABLATIONS.includes(a)) {
      console.error(`Unknown ablation "${a}". Valid: ${ALL_ABLATIONS.join(", ")}`);
      process.exit(1);
    }
  }

  // Each config = one experimental condition (one table row).
  opts.configs = [
    ...opts.modes.map((mode) => ({ mode, label: mode })),
    ...opts.ablations.map((ablation) => ({
      mode: "dr-rag",
      ablation,
      label: `dr-rag:${ablation}`,
    })),
  ];

  return opts;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const p95 = (xs) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

async function main() {
  const opts = parseArgs();
  const token = await login();

  const questions = (await api(token, "GET", "/api/benchmark/questions")).slice(
    0,
    opts.limit,
  );
  const totalRuns = questions.length * opts.configs.length;
  console.log(
    `Running ${questions.length} questions x ${opts.configs.length} config(s) = ${totalRuns} runs...\n`,
  );

  const results = [];
  let done = 0;

  for (const config of opts.configs) {
    for (const q of questions) {
      done += 1;
      const label = `[${done}/${totalRuns}] ${config.label} | ${q.question.slice(0, 55)}`;
      const body = { mode: config.mode };
      if (config.ablation) body.ablation = config.ablation;

      try {
        const started = Date.now();
        let r;
        // Gemini free-tier quota returns bursts of 429s; back off and retry.
        for (let attempt = 1; ; attempt += 1) {
          try {
            r = await api(token, "POST", `/api/benchmark/run/${q.id}`, body);
            break;
          } catch (e) {
            if (!String(e.message).includes("429") || attempt >= 4) throw e;
            const waitS = 30 * attempt;
            console.log(`${label} -> 429, retrying in ${waitS}s (attempt ${attempt})`);
            await new Promise((resolve) => setTimeout(resolve, waitS * 1000));
          }
        }
        results.push({
          questionId: q.id,
          question: q.question,
          difficulty: q.difficulty,
          subject: q.subject,
          documentId: q.documentId,
          config: config.label,
          mode: r.mode || config.mode,
          ablation: config.ablation,
          resultId: r.id,
          answer: r.answer,
          expectedAnswer: r.expectedAnswer,
          evaluation: r.evaluation,
          telemetry: r.telemetry,
          exactMatch: r.exactMatch,
          f1Score: r.f1Score,
          retrievalMetrics: r.retrievalMetrics,
          costMetrics: r.costMetrics,
          wallTimeMs: Date.now() - started,
        });
        console.log(`${label} -> score ${r.evaluation?.overallScore || 0}`);
      } catch (e) {
        results.push({
          questionId: q.id,
          question: q.question,
          difficulty: q.difficulty,
          config: config.label,
          mode: config.mode,
          ablation: config.ablation,
          error: String(e.message || e),
        });
        console.error(`${label} -> FAILED: ${e.message}`);
      }
    }
  }

  // Per-config summary for the paper tables
  const summary = {};
  for (const config of opts.configs) {
    const ok = results.filter((r) => r.config === config.label && !r.error);
    const failed = results.filter(
      (r) => r.config === config.label && r.error,
    ).length;
    const latencies = ok
      .map((r) => r.telemetry?.responseTimeMs)
      .filter((x) => typeof x === "number" && x > 0);

    summary[config.label] = {
      runs: ok.length,
      failed,
      avgOverallScore: Number(mean(ok.map((r) => r.evaluation?.overallScore || 0)).toFixed(3)),
      avgCorrectness: Number(mean(ok.map((r) => r.evaluation?.answerCorrectness || 0)).toFixed(3)),
      avgFaithfulness: Number(mean(ok.map((r) => r.evaluation?.faithfulness || 0)).toFixed(3)),
      avgRelevance: Number(mean(ok.map((r) => r.evaluation?.relevance || 0)).toFixed(3)),
      avgCompleteness: Number(mean(ok.map((r) => r.evaluation?.completeness || 0)).toFixed(3)),
      avgEM: Number(mean(ok.map((r) => r.exactMatch ? 1 : 0)).toFixed(3)),
      avgF1: Number(mean(ok.map((r) => r.f1Score || 0)).toFixed(3)),
      avgRecall5: Number(mean(ok.map((r) => r.retrievalMetrics?.recall5 || 0)).toFixed(3)),
      avgRecall10: Number(mean(ok.map((r) => r.retrievalMetrics?.recall10 || 0)).toFixed(3)),
      avgMrr: Number(mean(ok.map((r) => r.retrievalMetrics?.mrr || 0)).toFixed(3)),
      avgHit5: Number(mean(ok.map((r) => r.retrievalMetrics?.hit5 || 0)).toFixed(3)),
      avgCostUsd: Number(mean(ok.map((r) => r.costMetrics?.usdCost || 0)).toFixed(6)),
      avgLlmTokens: Math.round(mean(ok.map((r) => (r.costMetrics?.promptTokens || 0) + (r.costMetrics?.completionTokens || 0)))),
      avgEmbedTokens: Math.round(mean(ok.map((r) => r.costMetrics?.embeddingTokens || 0))),
      meanLatencyMs: Math.round(mean(latencies)),
      p95LatencyMs: Math.round(p95(latencies)),
      meanRetMs: Math.round(mean(ok.map((r) => r.telemetry?.retrievalLatencyMs || 0))),
      meanStageTwoMs: Math.round(mean(ok.map((r) => r.telemetry?.stageTwoLatencyMs || 0))),
      meanAgentMs: Math.round(mean(ok.map((r) => r.telemetry?.agentLatencyMs || 0))),
      meanGroundingMs: Math.round(mean(ok.map((r) => r.telemetry?.groundingLatencyMs || 0))),
      fallbackRate: Number(
        mean(ok.map((r) => (r.telemetry?.fallbackGenerated ? 1 : 0))).toFixed(3),
      ),
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath =
    opts.out || path.join(__dirname, "results", `benchmark-${stamp}.json`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");

  console.log("\n=== Per-mode summary ===");
  console.table(summary);
  console.log(`\nRaw results written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
