/**
 * Python execution for the code artifact.
 *
 * Ported from vercel/chatbot
 * `artifacts/code/client.tsx:1-195` and
 * `app/(chat)/layout.tsx:12-20` @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer: the upstream layout loads Pyodide globally. Roamlog loads
 * the same pinned runtime lazily on the first Run click so opening the AI page
 * does not download a multi-megabyte interpreter.
 */

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/";
const SCRIPT_ID = "roamlog-pyodide-runtime";

export type ConsoleOutputContent = {
  type: "text" | "image";
  value: string;
};

export type ConsoleOutputStatus =
  | "in_progress"
  | "loading_packages"
  | "completed"
  | "failed";

export type ConsoleOutput = {
  id: string;
  status: ConsoleOutputStatus;
  contents: ConsoleOutputContent[];
};

type PyodideInstance = {
  setStdout(options: { batched: (output: string) => void }): void;
  loadPackagesFromImports(
    code: string,
    options?: { messageCallback?: (message: string) => void },
  ): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
};

type PyodideLoader = (options: { indexURL: string }) => Promise<PyodideInstance>;

const OUTPUT_HANDLERS = {
  basic: `
    # Basic output capture setup
  `,
  matplotlib: `
    import io
    import base64
    from matplotlib import pyplot as plt

    plt.clf()
    plt.close('all')
    plt.switch_backend('agg')

    def setup_matplotlib_output():
        def custom_show():
            if plt.gcf().get_size_inches().prod() * plt.gcf().dpi ** 2 > 25_000_000:
                print("Warning: Plot size too large, reducing quality")
                plt.gcf().set_dpi(100)

            png_buf = io.BytesIO()
            plt.savefig(png_buf, format='png')
            png_buf.seek(0)
            png_base64 = base64.b64encode(png_buf.read()).decode('utf-8')
            print(f'data:image/png;base64,{png_base64}')
            png_buf.close()

            plt.clf()
            plt.close('all')

        plt.show = custom_show
  `,
};

function detectRequiredHandlers(code: string): string[] {
  const handlers = ["basic"];
  if (code.includes("matplotlib") || code.includes("plt.")) {
    handlers.push("matplotlib");
  }
  return handlers;
}

let runtimePromise: Promise<PyodideInstance> | null = null;

function loadPyodideRuntime(): Promise<PyodideInstance> {
  if (runtimePromise) return runtimePromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Python 只能在浏览器中运行。"));
  }

  const existing = (globalThis as { loadPyodide?: PyodideLoader }).loadPyodide;
  if (existing) {
    runtimePromise = existing({ indexURL: PYODIDE_INDEX_URL });
    return runtimePromise;
  }

  runtimePromise = new Promise<PyodideInstance>((resolve, reject) => {
    const start = (): void => {
      const loader = (globalThis as { loadPyodide?: PyodideLoader }).loadPyodide;
      if (!loader) {
        reject(new Error("Python 运行时没有正确加载。"));
        return;
      }
      loader({ indexURL: PYODIDE_INDEX_URL }).then(resolve, reject);
    };

    const present = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (present) {
      present.addEventListener("load", start, { once: true });
      present.addEventListener(
        "error",
        () => reject(new Error("Python 运行时加载失败，请检查网络后重试。")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `${PYODIDE_INDEX_URL}pyodide.js`;
    script.async = true;
    script.addEventListener("load", start, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Python 运行时加载失败，请检查网络后重试。")),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    runtimePromise = null;
    document.getElementById(SCRIPT_ID)?.remove();
    throw error;
  });

  return runtimePromise;
}

/**
 * Runs the artifact's Python content and reports one terminal output row.
 * Algorithm and output encoding match the upstream code artifact.
 */
export async function runPython(
  code: string,
  onUpdate: (output: ConsoleOutput) => void,
): Promise<void> {
  const runId = crypto.randomUUID();
  const outputContent: ConsoleOutputContent[] = [];
  let output: ConsoleOutput = {
    id: runId,
    status: "in_progress",
    contents: [],
  };
  onUpdate(output);

  try {
    const pyodide = await loadPyodideRuntime();
    pyodide.setStdout({
      batched: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        outputContent.push({
          type: trimmed.startsWith("data:image/png;base64") ? "image" : "text",
          value: trimmed,
        });
      },
    });

    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (message: string) => {
        output = {
          ...output,
          status: "loading_packages",
          contents: [{ type: "text", value: message }],
        };
        onUpdate(output);
      },
    });

    for (const handler of detectRequiredHandlers(code)) {
      const snippet = OUTPUT_HANDLERS[handler as keyof typeof OUTPUT_HANDLERS];
      if (snippet) await pyodide.runPythonAsync(snippet);
    }
    await pyodide.runPythonAsync(code);

    output = {
      ...output,
      status: "completed",
      contents: outputContent,
    };
    onUpdate(output);
  } catch (error) {
    output = {
      ...output,
      status: "failed",
      contents: [
        {
          type: "text",
          value: error instanceof Error ? error.message : String(error),
        },
      ],
    };
    onUpdate(output);
  }
}
