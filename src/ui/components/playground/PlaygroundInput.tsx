import { Send, Square } from "lucide-preact";

interface PlaygroundInputProps {
  userPrompt: string;
  onUserPromptChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
}

export function PlaygroundInput({
  userPrompt,
  onUserPromptChange,
  onSubmit,
  onStop,
  isLoading,
}: PlaygroundInputProps) {
  return (
    <div className="p-2.5 sm:p-3 border-t border-[#23232a] bg-[#121215]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-2"
      >
        <div className="relative">
          <textarea
            value={userPrompt}
            onInput={(e) => onUserPromptChange((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (userPrompt.trim() && !isLoading) {
                  onSubmit();
                }
              }
            }}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            rows={3}
            className="w-full p-2.5 sm:p-3 pr-20 sm:pr-24 bg-[#16161a] border border-[#262630] rounded-xl text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2b64e0] transition font-mono leading-relaxed resize-none"
          />
          <div className="absolute right-2 bottom-2.5 sm:right-2.5 sm:bottom-3 flex items-center gap-1.5">
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                <Square className="h-3 w-3 fill-white" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!userPrompt.trim()}
                className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg bg-[#2b64e0] hover:bg-[#3872ee] active:bg-[#2353be] text-xs font-semibold text-white transition shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
