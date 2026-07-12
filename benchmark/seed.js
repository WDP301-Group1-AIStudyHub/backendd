// Seeds benchmark questions from questions.json via the REST API.
// Idempotent: skips questions whose text already exists for this user.
//
// Usage: node benchmark/seed.js
const { readFileSync } = require("fs");
const path = require("path");
const { login, api } = require("./lib");

async function main() {
  const token = await login();
  const questions = JSON.parse(
    readFileSync(path.join(__dirname, "questions.json"), "utf8"),
  );

  const existing = await api(token, "GET", "/api/benchmark/questions");
  const existingTexts = new Set(existing.map((q) => q.question.trim()));

  let created = 0;
  let skipped = 0;

  for (const q of questions) {
    if (existingTexts.has(q.question.trim())) {
      skipped += 1;
      continue;
    }

    await api(token, "POST", "/api/benchmark/questions", q);
    created += 1;
    console.log(`created [${q.difficulty}] ${q.question.slice(0, 70)}`);
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed, ${existing.length + created} total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
