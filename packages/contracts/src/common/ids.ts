import { z } from "zod";

export const UuidV7Schema = z
  .uuid({ version: "v7" })
  .describe("Sortable UUIDv7 identifier.");
export type UuidV7 = z.infer<typeof UuidV7Schema>;

export const IsoTimestampSchema = z
  .iso.datetime({ offset: true })
  .describe("ISO 8601 timestamp with an explicit UTC offset.");
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export const DateOnlySchema = z
  .iso.date()
  .describe("Calendar date in YYYY-MM-DD form, without a timezone.");
export type DateOnly = z.infer<typeof DateOnlySchema>;

export const EmailSchema = z.email().max(254);
export type Email = z.infer<typeof EmailSchema>;

export const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type Slug = z.infer<typeof SlugSchema>;

export const CountryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;
