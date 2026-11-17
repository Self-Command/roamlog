function fixtureId(sequence: number): string {
  return `019a7e3a-2b40-7c1d-8a5f-${sequence.toString(16).padStart(12, "0")}`;
}

export const USER_ID = fixtureId(1);
export const COLLEAGUE_ID = fixtureId(2);
export const WORKSPACE_ID = fixtureId(3);
export const WEEKEND_WORKSPACE_ID = fixtureId(4);

export const SEOUL_TRIP_ID = fixtureId(16);
export const KYOTO_TRIP_ID = fixtureId(17);
export const ICELAND_TRIP_ID = fixtureId(18);
export const LISBON_TRIP_ID = fixtureId(19);
export const AMALFI_TRIP_ID = fixtureId(20);

export const CREATED_AT = "2026-10-12T03:40:00.000Z";
export const UPDATED_AT = "2026-11-17T01:20:00.000Z";

export { fixtureId };
