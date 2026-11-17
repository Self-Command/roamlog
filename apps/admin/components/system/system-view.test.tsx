import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_SYSTEM } from "../../lib/ops-fixtures";
import { SystemView } from "./system-view";

describe("SystemView", () => {
  it("renders API/Worker versions, migrations, build time, and Redis health", () => {
    render(<SystemView role="support" snapshot={MOCK_ADMIN_SYSTEM} />);

    expect(screen.getByText("1.0.0-rc.1")).toBeInTheDocument();
    expect(screen.getByText("24.4.1")).toBeInTheDocument();
    expect(screen.getByText("0003_export_cleanup")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("S3 / MinIO")).toBeInTheDocument();
  });
});
