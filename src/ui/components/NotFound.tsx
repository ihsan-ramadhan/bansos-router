import { AlertCircle, ArrowLeft } from "lucide-preact";

interface NotFoundProps {
  onGoHome?: () => void;
}

export function NotFound({ onGoHome }: NotFoundProps) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-4 py-8">
      <div className="h-14 w-14 rounded-xl bg-[#202028] border border-[#2c2c36] flex items-center justify-center text-amber-400 mb-4 shadow-sm">
        <AlertCircle className="h-7 w-7" />
      </div>
      <div className="text-[11px] font-bold tracking-wider uppercase text-amber-400 mb-1">
        HTTP 404
      </div>
      <h1 className="text-xl font-bold text-white mb-2 tracking-tight">
        Page Not Found
      </h1>
      <p className="text-xs text-[#9393a0] max-w-sm mb-6 leading-relaxed">
        The requested path or resource does not exist on this Bansos Router daemon instance.
      </p>
      {onGoHome ? (
        <button
          type="button"
          onClick={onGoHome}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-white font-medium text-xs transition shadow-sm cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Dashboard</span>
        </button>
      ) : (
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-white font-medium text-xs transition shadow-sm cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Dashboard</span>
        </a>
      )}
    </div>
  );
}
