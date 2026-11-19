import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminSystemSnapshotDetail } from "../../lib/admin-data-source";
import { sampleSystem } from "../../test/admin-sample-data";
import { SystemView } from "./system-view";

describe("SystemView", () => {
  it("renders the injected versions, migrations, checks, and fixture worker state", () => {
    render(<SystemView role="support" snapshot={sampleSystem} />);

    expect(screen.getByText("1.0.0-rc.1")).toBeInTheDocument();
    expect(screen.getByText("24.4.1")).toBeInTheDocument();
    expect(screen.getByText("0003_export_cleanup")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("S3 / MinIO")).toBeInTheDocument();
    expect(screen.getByText("后台任务进程")).toBeInTheDocument();
    expect(screen.getByText("健康")).toBeInTheDocument();
    expect(screen.getByText("3 / 4 正常")).toBeInTheDocument();
  });

  it("drops the previously hardcoded queue/Redis panel", () => {
    render(<SystemView role="support" snapshot={sampleSystem} />);

    expect(screen.queryByText("Up · 2 ms")).not.toBeInTheDocument();
    expect(screen.queryByText("4 queues")).not.toBeInTheDocument();
    expect(screen.queryByText("maxRetriesPerRequest")).not.toBeInTheDocument();
    expect(screen.getByText("队列注册")).toBeInTheDocument();
  });

  it("renders not-wired states instead of DOWN when the worker cannot be observed", () => {
    const snapshot: AdminSystemSnapshotDetail = {
      ...sampleSystem,
      apiVersion: "unconfigured",
      workerVersion: "unconfigured",
      buildTime: "",
      workerStatus: "down",
      workerConsumers: 0,
      workerSignal: {
        signal: "unavailable",
        consumers: 0,
        blockedConsumers: 0,
        lastJobAt: null,
        lastJobStatus: null,
        lastJobQueue: null,
      },
      queues: [],
    };

    render(<SystemView role="admin" snapshot={snapshot} />);

    expect(screen.queryByText("不可用")).not.toBeInTheDocument();
    expect(screen.getAllByText("未接入").length).toBeGreaterThan(1);
    expect(screen.getByText(/需要.*任务进程/)).toBeInTheDocument();
    expect(screen.getByText(/需要 ROAMLOG_API_VERSION/)).toBeInTheDocument();
    expect(screen.getByText(/需要 ROAMLOG_BUILD_TIME/)).toBeInTheDocument();
    expect(screen.getByText(/没有可识别的 BullMQ 队列键/)).toBeInTheDocument();
  });

  it("shows the observed consumer signal and its derivation in API mode", () => {
    const snapshot: AdminSystemSnapshotDetail = {
      ...sampleSystem,
      apiVersion: "1.0.0",
      buildTime: "2026-11-17T08:31:00.000Z",
      workerStatus: "up",
      workerConsumers: 2,
      workerSignal: {
        signal: "consumer-clients",
        consumers: 2,
        blockedConsumers: 2,
        lastJobAt: "2026-11-17T08:30:00.000Z",
        lastJobStatus: "completed",
        lastJobQueue: "email",
      },
      queues: [
        { name: "email", waiting: 0, active: 0, failed: 0, delayed: 0, paused: false },
      ],
    };

    render(<SystemView role="admin" snapshot={snapshot} />);

    expect(screen.getByText("健康")).toBeInTheDocument();
    expect(screen.getAllByText(/阻塞消费者/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Redis CLIENT LIST/)).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });
});