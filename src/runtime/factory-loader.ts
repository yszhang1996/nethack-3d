type NethackFactory = (moduleConfig: any) => Promise<any>;

function getGlobal(): any {
  return globalThis as any;
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
    try {
      importScripts("/nethack.js");
    } catch (error) {
      throw new Error(`Failed loading nethack.js in worker: ${String(error)}`);
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
    script.src = "/nethack.js";
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
