import { collectOracle } from "../../../shared/vendor-oracle.mjs";

export const vendor = "Oracle";
export async function collect() {
  const { records, report } = await collectOracle();
  if (report.status !== "success") console.warn(JSON.stringify(report));
  // Like HPE, an empty feed returns [] so vendor-watch warns instead of failing.
  if (report.issueCount === 1 && report.issues[0]?.kind === "empty_feed") return records;
  if (report.status === "failed") throw new Error(report.issues[0]?.message || report.message);
  return records;
}
