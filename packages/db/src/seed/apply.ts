import type { SeedDataset } from "./types.js";
import { applyContent } from "./apply-content.js";
import { applyFinance } from "./apply-finance.js";
import { applyIdentityAndTrips } from "./apply-identity.js";
import { applyOperations } from "./apply-operations.js";
import type { SeedTransaction } from "./apply-utils.js";

export async function applySeedData(
  tx: SeedTransaction,
  data: SeedDataset,
): Promise<void> {
  await applyIdentityAndTrips(tx, data);
  await applyContent(tx, data);

  for (const trip of data.trips) {
    if (trip.coverMediaId) {
      await tx.trip.update({
        where: { id: trip.id },
        data: { coverMediaId: trip.coverMediaId },
      });
    }
  }

  await applyFinance(tx, data);
  await applyOperations(tx, data);
}
