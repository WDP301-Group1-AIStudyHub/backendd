// Shared helpers for the benchmark scripts. Requires Node 18+ (global fetch).
const API = process.env.BENCH_API || "http://localhost:4000";

async function login() {
  const email = process.env.BENCH_EMAIL;
  const password = process.env.BENCH_PASSWORD;

  if (!email || !password) {
    console.error("Set BENCH_EMAIL and BENCH_PASSWORD environment variables first.");
    console.error('Example (PowerShell): $env:BENCH_EMAIL="you@x.com"; $env:BENCH_PASSWORD="..."; node benchmark/run.js');
    process.exit(1);
  }

  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();

  if (!res.ok || !body?.data?.accessToken) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(body)}`);
  }

  return body.data.accessToken;
}

async function api(token, method, path, payload) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return body.data;
}

module.exports = { API, login, api };
