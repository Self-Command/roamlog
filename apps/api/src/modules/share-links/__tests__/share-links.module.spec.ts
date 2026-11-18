import { Test } from "@nestjs/testing";
import { expect, it } from "vitest";

import { AppModule } from "../../../app.module.js";
import { TripCoverService } from "../../media/trip-cover.service.js";
import { ShareLinksRepository } from "../share-links.repository.js";
import { ShareLinksService } from "../share-links.service.js";

/**
 * The public cover is projected by the same `TripCoverService` the authenticated
 * trip reads use, so the share-links module graph must resolve it. Compiling
 * `AppModule` proves the constructor wiring (`MediaModule` re-exports
 * `MediaUrlModule`); `readPublic` failures in production would otherwise surface
 * only at request time.
 */
it("wires the share-links module with the public cover projector", async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  try {
    expect(moduleRef.get(ShareLinksService)).toBeInstanceOf(ShareLinksService);
    expect(moduleRef.get(ShareLinksRepository)).toBeInstanceOf(ShareLinksRepository);
    expect(moduleRef.get(TripCoverService)).toBeInstanceOf(TripCoverService);
  } finally {
    await moduleRef.close();
  }
});
