import type Redis from "ioredis";

export interface RedisChannelSubscriber {
  status: Redis["status"];
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "message", listener: (channel: string, message: string) => void): this;
  on(event: "ready", listener: () => void): this;
  subscribe(channel: string): Promise<number>;
  quit(): Promise<"OK">;
  disconnect(): void;
  removeAllListeners(): this;
}

export interface RedisChannelSubscription {
  close(): Promise<void>;
}

export type RedisChannelFailureOperation = "connection" | "subscribe";

export interface RedisChannelFailure {
  operation: RedisChannelFailureOperation;
  error: Error;
}

export interface RedisChannelSubscriptionOptions {
  createSubscriber: () => RedisChannelSubscriber;
  channel: string;
  onMessage: (message: string) => void;
  onFailure?: (failure: RedisChannelFailure) => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Redis channel subscription failed");
}

/**
 * Binds a dedicated Redis subscriber without racing the initial connection.
 *
 * The shared Redis client uses `enableOfflineQueue: false` so request-path
 * commands fail fast. Subscribers are different: `SUBSCRIBE` has to survive the
 * initial handshake, otherwise ioredis never records the channel and its
 * reconnect `autoResubscribe` behavior has nothing to replay. Subscriber
 * connections therefore opt into the offline queue and subscribe on `ready`.
 * Once the first subscription succeeds, ioredis owns re-subscription on later
 * reconnects.
 */
export function createRedisChannelSubscription(
  options: RedisChannelSubscriptionOptions,
): RedisChannelSubscription {
  const subscriber = options.createSubscriber();
  let closing = false;
  let subscribed = false;
  let subscribing: Promise<void> | undefined;

  const report = (operation: RedisChannelFailureOperation, error: unknown): void => {
    options.onFailure?.({ operation, error: asError(error) });
  };

  const ensureSubscribed = (): Promise<void> => {
    if (closing || subscribed || subscriber.status === "end" || subscriber.status === "wait") {
      return Promise.resolve();
    }
    if (subscribing) {
      return subscribing;
    }

    subscribing = subscriber
      .subscribe(options.channel)
      .then(
        () => {
          subscribed = true;
        },
        (error: unknown) => {
          report("subscribe", error);
        },
      )
      .finally(() => {
        subscribing = undefined;
      });
    return subscribing;
  };

  subscriber.on("error", (error) => report("connection", error));
  subscriber.on("message", (channel, message) => {
    if (channel === options.channel) {
      options.onMessage(message);
    }
  });
  subscriber.on("ready", () => {
    if (!subscribed) {
      // Let ioredis finish its own ready handler (including autoResubscribe)
      // before sending the first application subscription.
      queueMicrotask(() => {
        void ensureSubscribed();
      });
    }
  });

  if (subscriber.status === "ready") {
    queueMicrotask(() => {
      void ensureSubscribed();
    });
  }

  return {
    async close(): Promise<void> {
      if (closing) {
        return;
      }
      closing = true;
      try {
        if (subscriber.status === "ready") {
          await subscriber.quit();
        } else {
          subscriber.disconnect();
        }
      } catch {
        subscriber.disconnect();
      } finally {
        subscriber.removeAllListeners();
      }
    },
  };
}
