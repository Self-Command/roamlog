let startupPromise: Promise<void> | undefined;

export function startMockWorker(): Promise<void> {
  if (!startupPromise) {
    startupPromise = import("@roamlog/api-mocks/browser")
      .then(({ worker }) =>
        worker.start({
          onUnhandledRequest: "bypass",
          serviceWorker: {
            url: "/mockServiceWorker.js",
          },
        }),
      )
      .then(() => undefined);
  }

  return startupPromise;
}
