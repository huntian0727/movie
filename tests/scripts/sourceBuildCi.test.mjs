// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectExactCiRun, verifyExactMainCi } from "../../scripts/verify-source-build-ci.mjs";
const sha = "a".repeat(40);
const run = { id: 1, head_sha: sha, head_branch: "main", event: "push", repository: { full_name: "huntian0727/movie" },
  created_at: "2026-10-12T00:00:00Z", status: "completed", conclusion: "success" };
describe("exact-commit main CI prerequisite", () => {
  it("accepts only the exact commit tested on main in this repository", () => {
    expect(selectExactCiRun([run], sha)).toMatchObject({ state: "success", runId: 1, sha });
    for (const change of [{ head_sha: "b".repeat(40) }, { head_branch: "other" }, { event: "pull_request" }, { repository: { full_name: "other/repo" } }]) {
      expect(selectExactCiRun([{ ...run, ...change }], sha)).toEqual({ state: "missing" });
    }
    expect(() => selectExactCiRun([run], "a")).toThrow();
  });
  it.each(["failure", "cancelled", "skipped", "timed_out", null])("blocks the latest result %s even if an older run passed", conclusion => {
    expect(() => selectExactCiRun([run, { ...run, id: 2, created_at: "2026-10-12T00:01:00Z", conclusion }], sha)).toThrow();
  });
  it("keeps a pending latest run blocked instead of using a prior pass", () => {
    expect(selectExactCiRun([run, { ...run, id: 2, created_at: "2026-10-12T00:01:00Z", status: "in_progress", conclusion: null }], sha)).toEqual({ state: "pending" });
  });
  it("requires successful results from both workflow endpoints", async () => {
    const calls = [];
    const report = await verifyExactMainCi(sha, "synthetic", async (url, options) => { calls.push({ url, options }); return Response.json({ workflow_runs: [run] }); });
    expect(report.requiredWorkflows).toHaveLength(2); expect(calls[0].url).toContain("windows-ci.yml");
    expect(calls[1].url).toContain("security-audit.yml"); expect(calls.every(c => c.options.redirect === "error" && !c.options.method)).toBe(true);
    await expect(verifyExactMainCi(sha, "synthetic", async () => new Response(null, { status: 403 }))).rejects.toThrow(/403/);
  });
  it("does not let missing or pending evidence become an approval after a timeout", async () => {
    await expect(verifyExactMainCi(sha, "synthetic", async () => Response.json({ workflow_runs: [] }), { timeoutMs: 0 })).rejects.toThrow(/blocked/);
  });
});
