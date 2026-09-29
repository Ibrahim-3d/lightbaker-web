import { bakeStatus, getOrchestrator, isStale } from "shared";
import {
  artifacts,
  errorMessage,
  job,
  loading,
  resultMatches,
} from "../../../../src/studio";
import { apiConfigured } from "../../../../src/provider";
export function StatusBar() {
  const busy = bakeStatus.value === "baking";
  const preview = artifacts.value.find((a) => a.kind === "preview");
  return (
    <>
      <footer class="h-10 bg-bg-1 border-t border-border flex items-center gap-3 px-3 text-[12px] pointer-events-auto relative">
        <button
          data-testid="bake"
          title={
            apiConfigured
              ? "Submit authored scene to platform"
              : "Set VITE_LIGHTBAKER_API_URL to enable baking"
          }
          class="bg-accent text-bg-0 rounded px-3 py-1 font-semibold"
          disabled={!apiConfigured || busy || loading.value}
          onClick={() => void getOrchestrator()?.requestBake?.()}
        >
          {!apiConfigured
            ? "Platform API not configured"
            : busy
              ? "Baking on platform…"
              : "Bake on platform"}
        </button>
        <span>
          {busy
            ? `${job.value?.status ?? "Preparing scene"} · ${job.value?.progress ?? 0}%`
            : isStale.value
              ? "Bake required"
              : "Bake matches authored lighting"}
        </span>
        <span class="ml-auto text-text-1">
          W/E/R transform · F frame · RMB + WASD fly
        </span>
      </footer>
      {errorMessage.value && (
        <div
          role="alert"
          class="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 bg-bg-1 border border-stale p-3 pointer-events-auto max-w-xl text-stale"
        >
          {errorMessage.value}
          <button
            class="ml-3"
            onClick={() => {
              errorMessage.value = "";
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {preview && (
        <aside class="fixed bottom-14 right-[340px] w-72 bg-bg-1 border border-border rounded shadow-xl z-40 pointer-events-auto">
          <div class="p-2 flex justify-between">
            <span>
              {resultMatches.value
                ? "Platform result"
                : "Earlier scene result (stale)"}
            </span>
            <button
              onClick={() => {
                artifacts.value = [];
              }}
            >
              Close
            </button>
          </div>
          <img
            src={preview.url}
            alt="Platform baked scene preview"
            class="w-full"
          />
          <div class="p-2 flex gap-3">
            {artifacts.value.map((a) => (
              <a
                class="text-accent"
                href={a.url}
                target="_blank"
                rel="noreferrer"
              >
                {a.kind}
              </a>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
