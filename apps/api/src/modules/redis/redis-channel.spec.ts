import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  createRedisChannelSubscription,
  type RedisChannelSubscriber,
} from "./redis-channel.js";

class FakeSubscriber extends EventEmitter {
  status: RedisChannelSubscriber["status"] = "connecting";
  readonly subscribe = vi.fn(async () => 1);
  readonly quit = vi.fn(async () => "OK" as const);
  readonly disconnect = vi.fn();
}

function fakeSubscriber(): FakeSubscriber {
  return new FakeSubscriber();
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("createRedisChannelSubscription", () => {
  it("waits for ready before subscribing and dispatches only its channel", async () => {
    const subscriber = fakeSubscriber();
    const onMessage = vi.fn();
    const subscription = createRedisChannelSubscription({
      channel: "settings.invalidated",
      onMessage,
      createSubscriber: () => subscriber,
    });

    expect(subscriber.subscribe).not.toHaveBeenCalled();
    subscriber.status = "ready";
    subscriber.emit("ready");
    await flushMicrotasks();

    expect(subscriber.subscribe).toHaveBeenCalledWith("settings.invalidated");

    subscriber.emit("message", "another.channel", "ignored");
    subscriber.emit("message", "settings.invalidated", "changed");
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("changed");

    await subscription.close();
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it("does not resubscribe after the first success; ioredis owns reconnects", async () => {
    const subscriber = fakeSubscriber();
    subscriber.status = "ready";
    createRedisChannelSubscription({
      channel: "settings.invalidated",
      onMessage: vi.fn(),
      createSubscriber: () => subscriber,
    });
    await flushMicrotasks();

    subscriber.emit("ready");
    await flushMicrotasks();

    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  it("retries the first subscription after a failed attempt", async () => {
    const subscriber = fakeSubscriber();
    subscriber.status = "ready";
    subscriber.subscribe.mockRejectedValueOnce(new Error("connection lost"));
    const onFailure = vi.fn();
    createRedisChannelSubscription({
      channel: "providers.invalidated",
      onMessage: vi.fn(),
      onFailure,
      createSubscriber: () => subscriber,
    });
    await flushMicrotasks();

    expect(onFailure).toHaveBeenCalledWith({
      operation: "subscribe",
      error: expect.objectContaining({ message: "connection lost" }),
    });

    subscriber.emit("ready");
    await flushMicrotasks();
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
  });

  it("reports connection errors without throwing and stays attachable", async () => {
    const subscriber = fakeSubscriber();
    const onFailure = vi.fn();
    createRedisChannelSubscription({
      channel: "settings.invalidated",
      onMessage: vi.fn(),
      onFailure,
      createSubscriber: () => subscriber,
    });

    expect(() => subscriber.emit("error", new Error("redis down"))).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith({
      operation: "connection",
      error: expect.objectContaining({ message: "redis down" }),
    });
  });
});
