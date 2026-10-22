import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center shadow-2xl space-y-5">
        <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto">
          <Activity className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">404 — Page Not Found</h1>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            The page you are looking for does not exist or has been relocated within the Nutrient Earth system.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center space-x-2 w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-lg shadow-emerald-950/40"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Nutrition Calculator</span>
        </Link>
      </div>
    </main>
  );
}
