import { useState } from "preact/hooks";
import { KeyRound } from "lucide-preact";
import { login } from "../../services/api";

interface LoginScreenProps {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const value = key.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(value);
      setKey("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md w-full mx-auto mt-8 sm:mt-16 rounded-xl border border-[#23232a] bg-[#16161a] p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[#202028] text-[#60a5fa] border border-[#2c2c36] shrink-0">
          <KeyRound className="h-4 w-4" />
        </div>
        <div className="space-y-0.5 min-w-0">
          <span className="font-semibold text-white block text-sm">Sign in</span>
          <span className="text-[#a1a1aa] block text-[11px] sm:text-xs">
            This bansos daemon requires its API key.
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          name="api-key"
          autocomplete="current-password"
          placeholder="API key"
          value={key}
          onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          className="w-full px-3 py-2 rounded-lg bg-[#111113] border border-[#282832] text-xs sm:text-sm font-mono text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0]"
        />
        {error && <div className="text-xs text-rose-400">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !key.trim()}
          className="w-full px-3 py-2 rounded-lg bg-[#2b64e0] hover:bg-[#3b74f0] active:bg-[#2454c0] text-white text-xs sm:text-sm font-semibold cursor-pointer transition disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="text-[11px] text-[#9393a0]">
        Run{" "}
        <code className="text-white font-mono bg-[#111113] px-1 py-0.5 rounded border border-[#282832]">bansos key</code>{" "}
        on the machine running bansos to print the key.
      </p>
    </div>
  );
}
