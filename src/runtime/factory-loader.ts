import { resolveRuntimeAssetUrl } from "./runtime-assets";
type NethackFactory = (moduleConfig: any) => Promise<any>;

function getGlobal(): any {
  return globalThis as any;
}

async function loadWorkerFactoryFromFetchedScript(
  scriptUrl: string,
): Promise<NethackFactory> {
  const g = getGlobal();
  const response = await fetch(scriptUrl);
  if (!response.ok) {
    throw new Error(
      `Failed fetching nethack.js in worker: HTTP ${response.status}`,
    );
  }

  const source = await response.text();
  let evaluatedFactory: unknown;
  try {
    evaluatedFactory = new Function(
      "globalThis",
      `${source}
return typeof Module === "function"
  ? Module
  : (typeof globalThis.Module === "function" ? globalThis.Module : undefined);`,
    )(g);
  } catch (error) {
    throw new Error(
      `Failed evaluating nethack.js in worker: ${String(error)}`,
    );
  }

  if (typeof evaluatedFactory !== "function") {
    throw new Error(
      "nethack.js evaluated in worker but factory was not found on Module",
    );
  }

  g.Module = evaluatedFactory;
  g.__nethackFactory = evaluatedFactory;
  return evaluatedFactory as NethackFactory;
}

export async function loadNethackFactory(): Promise<NethackFactory> {
  const g = getGlobal();

  if (typeof g.__nethackFactory === "function") {
    return g.__nethackFactory;
  }

  if (typeof g.Module === "function") {
    g.__nethackFactory = g.Module;
    return g.__nethackFactory;
  }

  if (typeof importScripts === "function") {
    const nethackScriptUrl = resolveRuntimeAssetUrl("nethack.js");
    try {
      importScripts(nethackScriptUrl);
    } catch (error) {
      // Module workers expose importScripts but disallow calling it.
      try {
        return await loadWorkerFactoryFromFetchedScript(nethackScriptUrl);
      } catch (fallbackError) {
        throw new Error(
          `Failed loading nethack.js in worker: ${String(error)}. Fallback failed: ${String(fallbackError)}`,
        );
      }
    }

    if (typeof g.Module === "function") {
      g.__nethackFactory = g.Module;
      return g.__nethackFactory;
    }

    throw new Error("nethack.js loaded in worker but factory was not found on globalThis.Module");
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      "script[data-nethack-factory='1']",
    ) as HTMLScriptElement | null;

    if (existing) {
      if (typeof g.Module === "function") {
        g.__nethackFactory = g.Module;
        resolve();
        return;
      }

      existing.addEventListener("load", () => {
        if (typeof g.Module === "function") {
          g.__nethackFactory = g.Module;
          resolve();
          return;
        }
        reject(
          new Error(
            "nethack.js loaded but factory was not found on globalThis.Module",
          ),
        );
      });
      existing.addEventListener("error", () => {
        reject(new Error("Failed loading nethack.js"));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = resolveRuntimeAssetUrl("nethack.js");
    script.async = true;
    script.dataset.nethackFactory = "1";
    script.addEventListener("load", () => {
      if (typeof g.Module === "function") {
        g.__nethackFactory = g.Module;
        resolve();
        return;
      }
      reject(
        new Error(
          "nethack.js loaded but factory was not found on globalThis.Module",
        ),
      );
    });
    script.addEventListener("error", () => {
      reject(new Error("Failed loading nethack.js"));
    });
    document.head.appendChild(script);
  });

  if (typeof g.__nethackFactory !== "function") {
    throw new Error("NetHack factory is unavailable after script load");
  }

  return g.__nethackFactory;
}
