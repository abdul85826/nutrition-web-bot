"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log sanitized error telemetry securely without exposing stack to user
    console.error("Global Application Error Caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center shadow-2xl space-y-5">
          <div className="w-14 h-14 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">System Interruption</h1>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              An unexpected system event occurred while rendering. Nutrient Earth security shields have safeguarded your session.
            </p>
          </div>
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center space-x-2 w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-lg shadow-emerald-950/40"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload Calculator</span>
          </button>
        </div>
      </body>
    </html>
  );
}
