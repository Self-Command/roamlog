import { Controller, Get, Inject } from "@nestjs/common";

import { SettingsService } from "./settings.service.js";

/**
 * Anonymous, cache-friendly projection of `isPublic && !isSecret` settings.
 * The web shell uses it for site title/description, language, time zone, theme
 * defaults, and the login tagline. Secrets and operator-only values are never
 * part of the registry projection that feeds this endpoint.
 */
@Controller("public/settings")
export class PublicSettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getPublicSettings();
  }
}
