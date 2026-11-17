# @roamlog/api-mocks

Contract-aligned MSW handlers and fixtures for Web/Admin development.

```ts
import { worker } from "@roamlog/api-mocks/browser";
import { handlers } from "@roamlog/api-mocks/handlers";
import { demoFixtureState } from "@roamlog/api-mocks/fixtures";
```

The public exports are:

- `.` — fixtures and handlers
- `./fixtures` — contract-parsed development data
- `./handlers` — MSW handlers
- `./browser` — browser worker bootstrap

Implemented mock endpoints include:

- `GET /v1/me`
- `GET /v1/workspaces`
- `GET /v1/me/workspaces`
- `GET /v1/workspaces/:workspaceId/trips`
- `GET /v1/trips/:tripId`
- `GET /v1/trips/:tripId/itinerary`

Fixtures are parsed with `@roamlog/contracts` at module load. Do not define a second API type system in this package.
