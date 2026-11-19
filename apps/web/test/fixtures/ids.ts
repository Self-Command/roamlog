/**
 * Stable identifiers shared by the web test fixtures.
 *
 * These values intentionally keep the same ids that the retired shared mock
 * package produced: assertions such as `me.id === demoUser.id` and the
 * `fixtureId(sequence)` layout stay meaningful, so only ownership moved.
 * The data itself is web-test local now; nothing here is imported by the app.
 */
function fixtureId(sequence: number): string {
  return `019a7e3a-2b40-7c1d-8a5f-${sequence.toString(16).padStart(12, "0")}`;
}

export { fixtureId };

export const USER_ID = fixtureId(1);
/** The "Mira Chen" editor, referenced directly by the entry/comment seeds. */
export const EDITOR_USER_ID = fixtureId(2);
export const WORKSPACE_ID = fixtureId(3);
export const WEEKEND_WORKSPACE_ID = fixtureId(4);
export const ADMIN_USER_ID = fixtureId(5);
export const VIEWER_USER_ID = fixtureId(6);

export const SEOUL_TRIP_ID = fixtureId(16);
export const KYOTO_TRIP_ID = fixtureId(17);
export const ICELAND_TRIP_ID = fixtureId(18);
export const LISBON_TRIP_ID = fixtureId(19);
export const AMALFI_TRIP_ID = fixtureId(20);
export const PATAGONIA_TRIP_ID = fixtureId(21);
export const SANTORINI_TRIP_ID = fixtureId(22);
export const TOKYO_TRIP_ID = fixtureId(23);
export const MARRAKECH_TRIP_ID = fixtureId(24);

export const OWNER_MEMBER_ID = fixtureId(30);
export const EDITOR_MEMBER_ID = fixtureId(31);
export const ADMIN_MEMBER_ID = fixtureId(32);
export const VIEWER_MEMBER_ID = fixtureId(33);

export const CREATED_AT = "2026-10-12T03:40:00.000Z";
export const UPDATED_AT = "2026-11-17T01:20:00.000Z";