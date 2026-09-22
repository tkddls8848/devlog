import { collectHpe } from "../../../shared/vendor-hpe.mjs";

export const vendor = "HPE";
export async function collect() {
  const { records, report } = await collectHpe();
  if (report.status !== "success") console.warn(JSON.stringify(report));
  // Preserve the legacy CLI's empty-array contract; the Worker records this as failed.
  if (report.issueCount === 1 && report.issues[0]?.kind === "empty_page" && report.counts.candidates === 0) return records;
  if (report.status === "failed") throw new Error(report.issues[0]?.message || report.message);
  return records;
}
