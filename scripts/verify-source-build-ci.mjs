import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkedFile } from "./native-player-toolchain.mjs";

export const requiredWorkflows = ["windows-ci.yml", "security-audit.yml"];
export function selectExactCiRun(runs, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !Array.isArray(runs)) throw new Error("Invalid exact-commit CI evidence.");
  const candidates = runs.filter(run => run.head_sha === sha && run.head_branch === "main" && run.event === "push" &&
    run.repository?.full_name === "huntian0727/movie");
  candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  const latest = candidates[0];
  if (!latest) return { state: "missing" };
  if (!Number.isSafeInteger(latest.id) || !Number.isFinite(Date.parse(latest.created_at))) throw new Error("Invalid workflow run identity.");
  if (latest.status !== "completed") return { state: "pending" };
  if (latest.conclusion !== "success") throw new Error("Latest exact-commit main CI did not pass: " + latest.conclusion);
  return { state: "success", runId: latest.id, sha, url: `https://github.com/huntian0727/movie/actions/runs/${latest.id}` };
}

export async function verifyExactMainCi(sha, token, request = fetch, { timeoutMs = 15 * 60_000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), progress = () => {} } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("A complete reviewed commit SHA is required.");
  const deadline = Date.now() + timeoutMs, results = [];
  for (const workflow of requiredWorkflows) {
    let previous;
    while (true) {
      const response = await request(`https://api.github.com/repos/huntian0727/movie/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100&verification=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Cache-Control": "no-cache" },
        redirect: "error", signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error("Exact-commit CI evidence unavailable: " + response.status);
      const selected = selectExactCiRun((await response.json()).workflow_runs, sha);
      if (selected.state === "success") { results.push({ workflow, ...selected }); break; }
      if (selected.state !== previous) { progress(workflow + ": " + selected.state); previous = selected.state; }
      if (Date.now() >= deadline) throw new Error("Exact-commit main CI has not completed; build remains blocked.");
      await pause(Math.min(15_000, deadline - Date.now()));
    }
  }
  return { schemaVersion: 1, sha, requiredWorkflows: results, publicReleaseApproved: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sha = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true }).trim();
  const report = await verifyExactMainCi(sha, token, fetch, { progress: console.log });
  await writeFile(checkedFile(process.cwd(), path.join(process.cwd(), ".tmp/source-release-ci/exact-commit-ci.json")), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
