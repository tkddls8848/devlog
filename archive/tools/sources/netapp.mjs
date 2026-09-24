import { collectNetApp } from "../../../shared/vendor-netapp.mjs";

export const vendor = "NetApp";
export async function collect() {
  const { records, report } = await collectNetApp();
  if (report.status !== "success") console.warn(JSON.stringify(report));
  if (report.status === "failed") throw new Error(report.issues[0]?.message || report.message);
  return records;
}
