import { defineConfig } from "orval";

export const GENERATED_DIR = "src/generated";

export default defineConfig({
  roamlog: {
    input: {
      target: "../contracts/openapi.json",
    },
    output: {
      mode: "tags-split",
      target: `${GENERATED_DIR}/endpoints`,
      schemas: `${GENERATED_DIR}/schemas`,
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      formatter: "prettier",
      mock: false,
      override: {
        query: {
          signal: true,
        },
      },
    },
  },
});
